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
  if (!trimmed) throw new Error("Empty input");

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
    throw new Error("Not an object");
  } catch (e) {
    throw new Error(
      "Could not parse input as JSON or JS object: " +
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
    if (result.format === "json") return { ok: true, label: "Valid JSON", note: null };
    if (result.format === "js" || result.format === "js-eval")
      return { ok: true, label: "JS detected", note: "Auto-converted" };
    return null;
  } catch (e) {
    return { ok: false, label: "Invalid format", note: (e as Error).message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Stable canonical key for any value — used ONLY for sorting/matching,
 * never modifies original data. Object keys are alphabetically sorted so
 * {b:1,a:2} and {a:2,b:1} produce the same key.
 */
function stableKey(v: unknown): string {
  if (v === undefined) return "__undefined__";
  if (v !== v) return "__NaN__";                  // NaN
  if (v === Infinity) return "__Infinity__";
  if (v === -Infinity) return "__-Infinity__";
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableKey((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Normalize object key order recursively (sort keys alphabetically).
 * Does NOT sort array elements — array order is semantically significant.
 * Returns {sorted, changed} so the UI can show a notice when normalization happened.
 */
function normalizeKeyOrder(value: unknown): { sorted: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let anyChanged = false;
    const mapped = value.map(el => {
      const { sorted, changed } = normalizeKeyOrder(el);
      if (changed) anyChanged = true;
      return sorted;
    });
    return { sorted: mapped, changed: anyChanged };
  }
  if (isPlainObj(value)) {
    const originalKeys = Object.keys(value);
    const sortedKeys = [...originalKeys].sort();
    const keyOrderChanged = sortedKeys.some((k, i) => k !== originalKeys[i]);
    let anyChanged = keyOrderChanged;
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const { sorted, changed } = normalizeKeyOrder(value[key]);
      result[key] = sorted;
      if (changed) anyChanged = true;
    }
    return { sorted: result, changed: anyChanged };
  }
  return { sorted: value, changed: false };
}

// ─── Deep Diff Engine ──────────────────────────────────────────────────────────

/**
 * Array diff strategy:
 * - If all elements are primitives (or mixed primitives): SET-based diff
 *   → order-independent, reports added/removed per distinct value
 * - If elements are objects or arrays: ALIGN by best structural match,
 *   then recurse → fine-grained diffs inside each matched pair
 */
function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function diffArrays(a: unknown[], b: unknown[], path: string): DiffResult {
  const diffs: DiffResult = { added: [], removed: [], changed: [], same: [] };

  const allPrimitivesA = a.every(isPrimitive);
  const allPrimitivesB = b.every(isPrimitive);

  if (allPrimitivesA && allPrimitivesB) {
    // Pure primitive arrays: set-based diff (order-independent)
    const countA = new Map<string, { v: unknown; n: number }>();
    const countB = new Map<string, { v: unknown; n: number }>();
    for (const v of a) { const k = stableKey(v); const e = countA.get(k); e ? e.n++ : countA.set(k, { v, n: 1 }); }
    for (const v of b) { const k = stableKey(v); const e = countB.get(k); e ? e.n++ : countB.set(k, { v, n: 1 }); }

    let sameIdx = 0, addIdx = 0, rmIdx = 0;
    for (const [k, ea] of countA) {
      const eb = countB.get(k);
      const sameN = eb ? Math.min(ea.n, eb.n) : 0;
      for (let i = 0; i < sameN; i++) diffs.same.push({ path: `${path}[${sameIdx++}]`, value: ea.v });
      for (let i = sameN; i < ea.n; i++) diffs.removed.push({ path: `${path}[-${rmIdx++}]`, value: ea.v });
      if (eb) for (let i = sameN; i < eb.n; i++) diffs.added.push({ path: `${path}[+${addIdx++}]`, value: eb.v });
    }
    for (const [k, eb] of countB) {
      if (!countA.has(k)) for (let i = 0; i < eb.n; i++) diffs.added.push({ path: `${path}[+${addIdx++}]`, value: eb.v });
    }
    return diffs;
  }

  // Mixed/complex arrays: match by best structural similarity, recurse
  const usedB = new Set<number>();

  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const ka = stableKey(va);

    // Try exact match first
    let matchedJ = -1;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      if (stableKey(b[j]) === ka) { matchedJ = j; break; }
    }

    if (matchedJ !== -1) {
      usedB.add(matchedJ);
      diffs.same.push({ path: `${path}[${i}]`, value: va });
      continue;
    }

    // No exact match — find best structural match (same type, most similar)
    let bestJ = -1;
    let bestScore = -1;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      const vb = b[j];
      const sameType = (isPlainObj(va) && isPlainObj(vb)) || (Array.isArray(va) && Array.isArray(vb));
      if (!sameType) continue;
      // Score: count of matching keys (for objects) or matching elements (for arrays)
      let score = 0;
      if (isPlainObj(va) && isPlainObj(vb)) {
        const keysA = new Set(Object.keys(va));
        const keysB = new Set(Object.keys(vb));
        for (const k of keysA) if (keysB.has(k)) score++;
        // Boost if a meaningful "id" key matches
        for (const idKey of ["id", "key", "name", "type"]) {
          if (keysA.has(idKey) && keysB.has(idKey) && stableKey(va[idKey]) === stableKey((vb as Record<string, unknown>)[idKey])) score += 10;
        }
      } else if (Array.isArray(va) && Array.isArray(vb)) {
        const minLen = Math.min(va.length, vb.length);
        for (let k = 0; k < minLen; k++) if (stableKey(va[k]) === stableKey(vb[k])) score++;
      }
      if (score > bestScore) { bestScore = score; bestJ = j; }
    }

    if (bestJ !== -1) {
      usedB.add(bestJ);
      const n = deepDiff(va, b[bestJ], `${path}[${i}]`);
      diffs.added.push(...n.added);
      diffs.removed.push(...n.removed);
      diffs.changed.push(...n.changed);
      diffs.same.push(...n.same);
    } else {
      diffs.removed.push({ path: `${path}[${i}]`, value: va });
    }
  }

  for (let j = 0; j < b.length; j++) {
    if (!usedB.has(j)) diffs.added.push({ path: `${path}[${j}]`, value: b[j] });
  }

  return diffs;
}

function deepDiff(a: unknown, b: unknown, path = ""): DiffResult {
  const diffs: DiffResult = { added: [], removed: [], changed: [], same: [] };

  if (Array.isArray(a) && Array.isArray(b)) {
    return diffArrays(a, b, path);
  }

  if (isPlainObj(a) && isPlainObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      const p = path ? `${path}.${key}` : key;
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (!(key in (a as object))) diffs.added.push({ path: p, value: bv });
      else if (!(key in (b as object))) diffs.removed.push({ path: p, value: av });
      else {
        const n = deepDiff(av, bv, p);
        diffs.added.push(...n.added);
        diffs.removed.push(...n.removed);
        diffs.changed.push(...n.changed);
        diffs.same.push(...n.same);
      }
    }
    return diffs;
  }

  if (stableKey(a) !== stableKey(b))
    diffs.changed.push({ path: path || "(root)", from: a, to: b });
  else
    diffs.same.push({ path: path || "(root)", value: a });

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
      label: "ADDED",
      badge: "bg-emerald-950 text-emerald-400 border-emerald-700",
    },
    removed: {
      bg: "bg-red-950/60",
      border: "border-red-500/40",
      icon: <Minus size={11} className="text-red-400" />,
      label: "REMOVED",
      badge: "bg-red-550 border-red-700",
    },
    changed: {
      bg: "bg-amber-950/60",
      border: "border-amber-500/40",
      icon: <RefreshCw size={11} className="text-amber-400" />,
      label: "CHANGED",
      badge: "bg-amber-950 text-amber-400 border-amber-700",
    },
    same: {
      bg: "bg-slate-900/40",
      border: "border-slate-700/30",
      icon: <span className="w-2.5 h-0.5 bg-slate-600 rounded-full inline-block" />,
      label: "SAME",
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
        throw new Error("Object A is not a valid object or array");
      if (!isPlainObj(o2raw) && !Array.isArray(o2raw))
        throw new Error("Object B is not a valid object or array");

      // Sort arrays deeply inside both values before diffing
      const { sorted: o1, changed: changed1 } = normalizeKeyOrder(o1raw);
      const { sorted: o2, changed: changed2 } = normalizeKeyOrder(o2raw);
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
        label: "All",
        count: results.added.length + results.removed.length + results.changed.length,
      },
      { id: "changed", label: "Changed", count: results.changed.length },
      { id: "added", label: "Added", count: results.added.length },
      { id: "removed", label: "Removed", count: results.removed.length },
      { id: "same", label: "Same", count: results.same.length },
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
              Compare two JSON objects/arrays — properties, values, equality
            </div>
            <div className="flex flex-wrap gap-3 px-1">
              <span className="font-bold">Accepted formats:</span>
              <span>JSON standard <span>{'{ "key": "val" }'}</span></span>
              <span>•</span>
              <span>JS object <span>{"{ key: 'val' }"}</span></span>
              <span>•</span>
              <span>Single quotes <span>{"'val'"}</span></span>
              <span>•</span>
              <span>Unquoted keys</span>
            </div>
          </CardDescription>
        </CardTitle>
      </CardHeader>

      <CardContent className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Input panels */}
        <div className="grid md:grid-cols-2 gap-4">
          <InputPanel
            label="Object A"
            accent="cyan"
            raw={raw1}
            setRaw={(v) => { setRaw1(v); setResults(null); }}
            status={status1}
          />
          <InputPanel
            label="Object B"
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
          ANALYZE DIFFERENCES
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
                <ArrowUpDown className="h-4 w-4 text-sky-300" />
                <AlertDescription>
                  <span className="text-sky-100 font-bold block">Arrays were automatically sorted</span>
                  <span className="text-secondary-foreground text-xs">
                    Object keys were normalized alphabetically in both structures — differences reflect actual values, not key order.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {results && !isIdentical && (
              <div className="flex gap-3 text-xs font-bold font-mono">
                <span className="text-amber-400">{results.changed.length} changed</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-emerald-400">{results.added.length} added</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-red-400">{results.removed.length} removed</span>
                <Separator orientation="vertical" className="h-4 bg-slate-700" />
                <span className="text-slate-500">{results.same.length} same</span>
              </div>
            )}

            {isIdentical ? (
              <Alert className="bg-emerald-950/40 border-emerald-500/30 text-emerald-400">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-bold block">Objects are identical ✓</span>
                  <span className="text-xs text-slate-400">
                    {results.same.length} properties compared — no differences
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
                    Copy results
                  </Button>
                </div>

                <div className="space-y-1.5">
                  {visibleItems.length === 0 ? (
                    <p className="text-center text-sm py-10">
                      No differences in this category.
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
                    {showSame ? "Hide" : "Show"} {results.same.length} identical properties
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