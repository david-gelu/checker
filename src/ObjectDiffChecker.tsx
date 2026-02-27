import { useState, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  ChevronRight,
  ChevronDown,
  Minus,
  Plus,
  RefreshCw,
  AlertTriangle,
  Wand2,
  ArrowUpDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "./lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ParseResult {
  value: unknown;
  format: "json" | "js" | "js-eval";
  fixed?: string;
}

interface ParseStatus {
  ok: boolean;
  label: string;
  note: string | null;
}

interface DiffEntry {
  path: string;
  value?: unknown;
  from?: unknown;
  to?: unknown;
}

interface DiffResult {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: Array<{ path: string; from: unknown; to: unknown }>;
  same: DiffEntry[];
}

type DiffType = "added" | "removed" | "changed" | "same";

interface DiffItem extends DiffEntry {
  type: DiffType;
}

interface TabConfig {
  id: string;
  label: string;
  count: number;
}

// ─── Smart Parser ───────────────────────────────────────────────────────────────

function smartParse(str: string): ParseResult {
  const trimmed = str.trim();
  if (!trimmed) throw new Error("Input gol");

  try {
    return { value: JSON.parse(trimmed), format: "json" };
  } catch (_) { }

  try {
    let s = trimmed;
    s = s.replace(/'/g, '"');
    s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');
    s = s.replace(/,(\s*[}\]])/g, "$1");
    s = s.replace(/:\s*undefined/g, ": null");
    s = s.replace(/:\s*-?Infinity/g, ": null");
    return { value: JSON.parse(s), format: "js", fixed: s };
  } catch (_) { }

  try {
    // eslint-disable-next-line no-new-func
    const val = Function('"use strict"; return (' + trimmed + ")")();
    if (typeof val === "object" && val !== null) {
      return { value: val, format: "js-eval", fixed: JSON.stringify(val, null, 2) };
    }
    throw new Error("Nu este un obiect");
  } catch (e) {
    throw new Error(
      "Nu am putut parsa inputul nici ca JSON, nici ca obiect JS: " +
      (e as Error).message
    );
  }
}

function toJson(str: string): string | null {
  try {
    const { fixed, value } = smartParse(str);
    return fixed || JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function getParseStatus(str: string): ParseStatus | null {
  if (!str.trim()) return null;
  try {
    const result = smartParse(str);
    if (result.format === "json") return { ok: true, label: "JSON valid", note: null };
    if (result.format === "js" || result.format === "js-eval")
      return { ok: true, label: "JS detectat", note: "Convertit automat" };
    return null;
  } catch (e) {
    return { ok: false, label: "Format invalid", note: (e as Error).message };
  }
}

// ─── Sort Helpers ──────────────────────────────────────────────────────────────

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Canonicalizează recursiv: sortează cheile obiectelor și elementele
 * array-urilor după reprezentarea JSON, pentru o comparație stabilă.
 */
// Natural sort comparator — handles numbers, zero-padded strings, mixed content
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function naturalCompare(a: unknown, b: unknown): number {
  const sa = JSON.stringify(canonicalize(a)) ?? '';
  const sb = JSON.stringify(canonicalize(b)) ?? '';
  return collator.compare(sa, sb);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map(canonicalize);
    return mapped.sort((a, b) => naturalCompare(a, b));
  }
  if (isPlainObj(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Sortează recursiv toate array-urile dintr-un obiect/array.
 * Returnează valoarea sortată + un flag care indică dacă ceva s-a schimbat.
 */
function sortDeep(value: unknown): { sorted: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    const mappedResults = value.map(sortDeep);
    const mappedArr = mappedResults.map((r) => r.sorted);
    const innerChanged = mappedResults.some((r) => r.changed);
    const sortedArr = [...mappedArr].sort((a, b) => naturalCompare(a, b));
    const orderChanged =
      innerChanged ||
      sortedArr.some((v, i) => JSON.stringify(canonicalize(v)) !== JSON.stringify(canonicalize(mappedArr[i])));
    return { sorted: sortedArr, changed: orderChanged };
  }
  if (isPlainObj(value)) {
    // Sort keys alphabetically so objects with same keys in different order compare as equal
    const sortedKeys = Object.keys(value).sort();
    const originalKeys = Object.keys(value);
    const keyOrderChanged = sortedKeys.some((k, i) => k !== originalKeys[i]);
    let anyChanged = keyOrderChanged;
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const { sorted, changed } = sortDeep(value[key]);
      result[key] = sorted;
      if (changed) anyChanged = true;
    }
    return { sorted: result, changed: anyChanged };
  }
  return { sorted: value, changed: false };
}

// ─── Deep Diff Engine ──────────────────────────────────────────────────────────

function deepDiff(a: unknown, b: unknown, path = ""): DiffResult {
  const diffs: DiffResult = { added: [], removed: [], changed: [], same: [] };

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) diffs.added.push({ path: p, value: b[i] });
      else if (i >= b.length) diffs.removed.push({ path: p, value: a[i] });
      else {
        const n = deepDiff(a[i], b[i], p);
        diffs.added.push(...n.added);
        diffs.removed.push(...n.removed);
        diffs.changed.push(...n.changed);
        diffs.same.push(...n.same);
      }
    }
    return diffs;
  }

  if (isPlainObj(a) && isPlainObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const p = path ? `${path}.${key}` : key;
      if (!(key in a)) diffs.added.push({ path: p, value: b[key] });
      else if (!(key in b)) diffs.removed.push({ path: p, value: a[key] });
      else {
        const n = deepDiff(a[key], b[key], p);
        diffs.added.push(...n.added);
        diffs.removed.push(...n.removed);
        diffs.changed.push(...n.changed);
        diffs.same.push(...n.same);
      }
    }
    return diffs;
  }

  if (JSON.stringify(a) !== JSON.stringify(b))
    diffs.changed.push({ path: path || "(root)", from: a, to: b });
  else diffs.same.push({ path: path || "(root)", value: a });

  return diffs;
}

// ─── UI Helpers ────────────────────────────────────────────────────────────────

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null) return <span className="italic">null</span>;
  if (value === undefined) return <span className="italic">undefined</span>;
  if (typeof value === "boolean")
    return <span className="font-mono">{value.toString()}</span>;
  if (typeof value === "number")
    return <span className="font-mono">{value}</span>;
  if (typeof value === "string")
    return <span className="font-mono">"{value}"</span>;
  if (Array.isArray(value))
    return <span className="font-mono">[{value.length} elem.]</span>;
  if (isPlainObj(value))
    return (
      <span className="font-mono">
        {"{"} {Object.keys(value).length} chei{"}"}
      </span>
    );
  return <span className="font-mono">{JSON.stringify(value)}</span>;
}

interface DiffRowProps {
  type: DiffType;
  path: string;
  from?: unknown;
  to?: unknown;
  value?: unknown;
}

function DiffRow({ type, path, from, to, value }: DiffRowProps) {
  const cfg = {
    added: {
      bg: "bg-emerald-950/60",
      border: "border-emerald-500/40",
      icon: <Plus size={11} className="text-emerald-400" />,
      label: "ADĂUGAT",
      badge: "bg-emerald-950 text-emerald-400 border-emerald-700",
    },
    removed: {
      bg: "bg-red-950/60",
      border: "border-red-500/40",
      icon: <Minus size={11} className="text-red-400" />,
      label: "ELIMINAT",
      badge: "bg-red-950 border-red-700",
    },
    changed: {
      bg: "bg-amber-950/60",
      border: "border-amber-500/40",
      icon: <RefreshCw size={11} className="text-amber-400" />,
      label: "MODIFICAT",
      badge: "bg-amber-950 text-amber-400 border-amber-700",
    },
    same: {
      bg: "bg-slate-900/40",
      border: "border-slate-700/30",
      icon: <span className="w-2.5 h-0.5 bg-slate-600 rounded-full inline-block" />,
      label: "IDENTIC",
      badge: "bg-slate-900 text-slate-500 border-slate-700",
    },
  }[type];

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-mono",
        cfg.bg,
        cfg.border
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Badge
          variant="outline"
          className={cn("text-[9px] font-bold tracking-widest shrink-0 px-1.5 py-0.5 flex items-center gap-1", cfg.badge)}
        >
          {cfg.icon}
          {cfg.label}
        </Badge>
        <span className="truncate">{path}</span>
      </div>

      {type === "changed" && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="line-through opacity-70">
            <ValueDisplay value={from} />
          </span>
          <ChevronRight size={11} />
          <ValueDisplay value={to} />
        </div>
      )}

      {(type === "added" || type === "removed" || type === "same") && (
        <div className="shrink-0">
          <ValueDisplay value={value} />
        </div>
      )}
    </div>
  );
}

// ─── Input Panel ───────────────────────────────────────────────────────────────

interface InputPanelProps {
  label: string;
  accent: "cyan" | "violet";
  raw: string;
  setRaw: (v: string) => void;
  status: ParseStatus | null;
}

function InputPanel({ label, accent, raw, setRaw, status }: InputPanelProps) {
  const handleAutofix = useCallback(() => {
    const fixed = toJson(raw);
    if (fixed) setRaw(fixed);
  }, [raw, setRaw]);

  const accentColor = accent === "cyan" ? "text-cyan-400" : "text-violet-400";
  const borderColor = accent === "cyan" ? "border-cyan-500/30" : "border-violet-500/30";
  const focusBorder = accent === "cyan" ? "focus-within:border-cyan-500/60" : "focus-within:border-violet-500/60";

  return (
    <Card className={cn("transition-colors", focusBorder)}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className={cn("text-sm tracking-wider font-mono", accentColor)}>
            {label}
          </CardTitle>

          <div className="flex items-center gap-2">
            {raw.trim() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAutofix}
                className="h-6 px-2 text-[10px] gap-1"
              >
                <Wand2 size={10} />
                Auto-fix JSON
              </Button>
            )}

            {raw.trim() && status && (
              status.ok ? (
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="text-[9px] border-emerald-700/50 font-mono px-1.5 gap-1"
                  >
                    <CheckCircle size={9} />
                    {status.label}
                  </Badge>
                  {status.note && (
                    <span className="text-[9px]">({status.note})</span>
                  )}
                </div>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[9px] bg-red-950/50 text-red-400 border-red-700/50 font-mono px-1.5 gap-1"
                >
                  <AlertCircle size={9} />
                  {status.label}
                </Badge>
              )
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-1.5">
        <div className={cn("rounded-lg border transition-colors", borderColor)}>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={(e) => setRaw(e.target.value.trim())}
            className="h-56 border-0 bg-transparent text-sm font-mono resize-none focus-visible:ring-0 focus-visible:ring-offset-0 leading-relaxed"
            placeholder={'// JSON:\n{ "key": "value", "arr": [1, 2] }\n\n// sau JS:\n{ key: \'value\', arr: [1, 2] }'}
            spellCheck={false}
          />
        </div>

        {raw.trim() && status && !status.ok && (
          <p className="text-xs text-red-400 flex items-start gap-1.5 px-1">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            {status.note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ObjectDiffChecker() {
  const [raw1, setRaw1] = useState<string>("");
  const [raw2, setRaw2] = useState<string>("");
  const [results, setResults] = useState<DiffResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [showSame, setShowSame] = useState<boolean>(false);
  const [wasSorted, setWasSorted] = useState<boolean>(false);

  const status1 = getParseStatus(raw1);
  const status2 = getParseStatus(raw2);

  const analyze = useCallback(() => {
    setParseError(null);
    setWasSorted(false);
    try {
      const { value: o1raw } = smartParse(raw1);
      const { value: o2raw } = smartParse(raw2);
      if (!isPlainObj(o1raw) && !Array.isArray(o1raw))
        throw new Error("Obiect A nu este un obiect sau array valid");
      if (!isPlainObj(o2raw) && !Array.isArray(o2raw))
        throw new Error("Obiect B nu este un obiect sau array valid");

      // Sort arrays deeply inside both values before diffing
      const { sorted: o1, changed: changed1 } = sortDeep(o1raw);
      const { sorted: o2, changed: changed2 } = sortDeep(o2raw);
      setWasSorted(changed1 || changed2);

      setResults(deepDiff(o1, o2));
      setActiveTab("all");
      setShowSame(false);
    } catch (e) {
      setParseError((e as Error).message);
      setResults(null);
    }
  }, [raw1, raw2]);

  const copyToClipboard = useCallback(
    (data: unknown) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)),
    []
  );

  const isIdentical =
    results &&
    !results.added.length &&
    !results.removed.length &&
    !results.changed.length;

  const tabs: TabConfig[] = results
    ? [
      {
        id: "all",
        label: "Toate",
        count: results.added.length + results.removed.length + results.changed.length,
      },
      { id: "changed", label: "Modificate", count: results.changed.length },
      { id: "added", label: "Adăugate", count: results.added.length },
      { id: "removed", label: "Eliminate", count: results.removed.length },
      { id: "same", label: "Identice", count: results.same.length },
    ]
    : [];

  const visibleItems: DiffItem[] = results
    ? activeTab === "same"
      ? results.same.map((d) => ({ type: "same" as DiffType, ...d }))
      : activeTab === "changed"
        ? results.changed.map((d) => ({ type: "changed" as DiffType, ...d }))
        : activeTab === "added"
          ? results.added.map((d) => ({ type: "added" as DiffType, ...d }))
          : activeTab === "removed"
            ? results.removed.map((d) => ({ type: "removed" as DiffType, ...d }))
            : [
              ...results.changed.map((d) => ({ type: "changed" as DiffType, ...d })),
              ...results.added.map((d) => ({ type: "added" as DiffType, ...d })),
              ...results.removed.map((d) => ({ type: "removed" as DiffType, ...d })),
              ...(showSame ? results.same.map((d) => ({ type: "same" as DiffType, ...d })) : []),
            ]
    : [];

  return (
    <Card
      className="min-h-auto"
      style={{ fontFamily: "'IBM Plex Mono','Fira Code','Courier New',monospace" }}
    >
      <CardHeader className="space-y-6">
        <CardTitle className="border-b border-slate-800 pb-4">
          <h1 className="text-lg font-black tracking-tight">
            <span className="text-cyan-400">obj</span>
            <span className="text-slate-600">.</span>
            <span className="text-emerald-400">diff</span>
            <span className="text-slate-600">()</span>
          </h1>
          <CardDescription className="text-[1rem] mt-0.5">
            <div className="my-4">
              Compară două obiecte/array-uri JSON — proprietăți, valori, egalitate
            </div>
            <div className="flex flex-wrap gap-3 px-1">
              <span className="font-bold">Formate acceptate:</span>
              <span>JSON standard <span>{'{ "key": "val" }'}</span></span>
              <span>•</span>
              <span>JS object <span>{"{ key: 'val' }"}</span></span>
              <span>•</span>
              <span>Ghilimele simple <span>{"'val'"}</span></span>
              <span>•</span>
              <span>Chei fără ghilimele</span>
            </div>
          </CardDescription>
        </CardTitle>
      </CardHeader>

      <CardContent className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Input panels */}
        <div className="grid md:grid-cols-2 gap-4">
          <InputPanel
            label="Obiect A"
            accent="cyan"
            raw={raw1}
            setRaw={(v) => { setRaw1(v); setResults(null); }}
            status={status1}
          />
          <InputPanel
            label="Obiect B"
            accent="violet"
            raw={raw2}
            setRaw={(v) => { setRaw2(v); setResults(null); }}
            status={status2}
          />
        </div>

        {/* Analyze button */}
        <Button
          onClick={analyze}
          disabled={!raw1.trim() || !raw2.trim()}
          className="w-full py-6 text-sm tracking-widest rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/20"
        >
          ANALIZEAZĂ DIFERENȚELE
        </Button>

        {/* Parse error */}
        {parseError && (
          <Alert variant="destructive" className="bg-red-950/60 border-red-500/40 text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {results && (
          <CardFooter className="space-y-4 flex flex-col items-stretch justify-between">

            {/* Sort notice */}
            {wasSorted && (
              <Alert className="bg-sky-950/40 border-sky-500/30">
                <ArrowUpDown className="h-4 w-4 text-sky-400" />
                <AlertDescription>
                  <span className="text-sky-400 font-bold block">Array-urile au fost sortate automat</span>
                  <span className="text-slate-400 text-xs">
                    Cheile obiectelor și elementele array-urilor au fost sortate alfabetic/canonic în ambele structuri — diferențele reflectă valorile reale, nu ordinea lor.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {results && !isIdentical && (
              <div className="flex gap-3 text-xs font-bold font-mono">
                <span className="text-amber-400">{results.changed.length} modificate</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-emerald-400">{results.added.length} adăugate</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-red-400">{results.removed.length} eliminate</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-slate-500">{results.same.length} identice</span>
              </div>
            )}

            {isIdentical ? (
              <Alert className="bg-emerald-950/40 border-emerald-500/30 text-emerald-400">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-bold block">Obiectele sunt identice ✓</span>
                  <span className="text-xs text-slate-400">
                    {results.same.length} proprietăți comparate — nicio diferență
                  </span>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="border h-auto p-1 gap-0.5 w-full flex justify-start overflow-x-auto">
                    {tabs.map((tab) => (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="text-xs font-bold tracking-wide px-3 py-2 rounded-lg gap-2 whitespace-nowrap"
                      >
                        {tab.label}
                        <Badge variant="outline" className="text-[10px] px-1.5 font-mono border">
                          {tab.count}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(visibleItems)}
                    className="h-7 px-3 text-xs gap-1.5"
                  >
                    <Copy size={11} />
                    Copiază rezultatele
                  </Button>
                </div>

                <div className="space-y-1.5">
                  {visibleItems.length === 0 ? (
                    <p className="text-center text-sm py-10">
                      Nicio diferență în această categorie.
                    </p>
                  ) : (
                    visibleItems.map((item, i) => <DiffRow key={i} {...item} />)
                  )}
                </div>

                {activeTab === "all" && results.same.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSame((s) => !s)}
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 mx-auto"
                  >
                    {showSame ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {showSame ? "Ascunde" : "Arată"} {results.same.length} proprietăți identice
                  </Button>
                )}
              </>
            )}
          </CardFooter>
        )}
      </CardContent>
    </Card>
  );
}