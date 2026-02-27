import React, { useState, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Equal,
  ChevronRight,
  ChevronDown,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DuplicateEntry {
  item: unknown;
  count: number;
}

type DiffType = "added" | "removed" | "changed" | "same";

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

interface DiffItem extends DiffEntry {
  type: DiffType;
}

interface TabConfig {
  id: string;
  label: string;
  count: number;
}

interface AnalysisResults {
  length1: number;
  length2: number;
  uniqueLength1: number;
  uniqueLength2: number;
  duplicates1: DuplicateEntry[];
  duplicates2: DuplicateEntry[];
  areIdentical: boolean;
  sameUniqueElements: boolean;
  diff: DiffResult;
}

// ─── Parser ────────────────────────────────────────────────────────────────────

/**
 * Tolerant parser: handles JSON + JS-like syntax (single quotes, unquoted keys,
 * trailing commas, undefined, Infinity, -Infinity).
 * undefined becomes the symbol UNDEFINED_SENTINEL so it survives JSON.stringify.
 */
const UNDEF = "__UNDEFINED__" as const;

function preprocessJS(raw: string): string {
  let s = raw.trim();
  // undefined → sentinel string (we replace it back after parse)
  s = s.replace(/:\s*undefined(?=\s*[,}\]])/g, ': "__UNDEFINED__"');
  s = s.replace(/,\s*undefined(?=\s*[,\]])/g, ', "__UNDEFINED__"');
  s = s.replace(/\[\s*undefined(?=\s*[,\]])/g, '["__UNDEFINED__"');
  s = s.replace(/(?<=\[)\s*undefined(?=\s*\])/g, '"__UNDEFINED__"');
  // single quotes → double quotes (naive but works for non-nested)
  s = s.replace(/'/g, '"');
  // unquoted keys
  s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');
  // trailing commas
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // Infinity
  s = s.replace(/:\s*-Infinity/g, ': "-Infinity__"');
  s = s.replace(/:\s*Infinity/g, ': "Infinity__"');
  return s;
}

function revive(v: unknown): unknown {
  if (v === UNDEF) return undefined;
  if (Array.isArray(v)) return v.map(revive);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = revive(val);
    }
    return out;
  }
  return v;
}

function safeParse(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Input gol.");

  // First try strict JSON
  try {
    const p = JSON.parse(trimmed);
    if (!Array.isArray(p)) throw new Error("Input-ul nu este un array JSON valid.");
    return p as unknown[];
  } catch (_) { }

  // Then try preprocessed JS-like syntax
  try {
    const preprocessed = preprocessJS(trimmed);
    const p = JSON.parse(preprocessed);
    if (!Array.isArray(p)) throw new Error("Input-ul nu este un array.");
    return revive(p) as unknown[];
  } catch (_) { }

  // Last resort: Function eval (handles complex JS objects)
  try {
    // eslint-disable-next-line no-new-func
    const val = Function('"use strict"; return (' + trimmed + ')')();
    if (!Array.isArray(val)) throw new Error("Input-ul nu este un array.");
    return val as unknown[];
  } catch (e) {
    throw new Error("Format invalid: " + (e as Error).message);
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Serialize any value to a stable string — handles undefined, NaN, Infinity */
function stableStringify(v: unknown): string {
  if (v === undefined) return "__undefined__";
  if (v !== v) return "__NaN__"; // NaN check
  if (v === Infinity) return "__Infinity__";
  if (v === -Infinity) return "__-Infinity__";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

// ─── Sort & Canonicalize ───────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Stable sort key: objects get alphabetically-sorted keys, arrays get
 * sorted elements — used ONLY for ordering, never modifies original data.
 */
function sortKey(v: unknown): string {
  return stableStringify(v);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findDuplicates(arr: unknown[]): DuplicateEntry[] {
  const counts = new Map<string, { item: unknown; count: number }>();
  for (const item of arr) {
    const key = sortKey(item);
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { item, count: 1 });
  }
  return [...counts.values()].filter((e) => e.count > 1);
}

function arraysAreIdentical(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => sortKey(val) === sortKey(b[i]));
}

function sameUniqueSet(a: unknown[], b: unknown[]): boolean {
  const setA = new Set(a.map(sortKey));
  const setB = new Set(b.map(sortKey));
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

// ─── Deep Diff Engine ──────────────────────────────────────────────────────────

/**
 * Hybrid array diff:
 * 1. Match elements by canonical key (order-independent, exact matches first).
 * 2. For unmatched complex values (objects/arrays), try to pair them up and
 *    recurse into them to surface fine-grained diffs instead of add/remove.
 * 3. Remaining unmatched → added / removed.
 */
function diffArrays(a: unknown[], b: unknown[], path: string): DiffResult {
  const diffs: DiffResult = { added: [], removed: [], changed: [], same: [] };

  const usedA = new Set<number>();
  const usedB = new Set<number>();

  // Pass 1: exact canonical matches
  for (let i = 0; i < a.length; i++) {
    const ka = sortKey(a[i]);
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      if (sortKey(b[j]) === ka) {
        diffs.same.push({ path: `${path}[${i}]`, value: a[i] });
        usedA.add(i);
        usedB.add(j);
        break;
      }
    }
  }

  // Pass 2: pair up unmatched complex values (obj↔obj or arr↔arr) and recurse
  const unmatchedA = a.map((v, i) => i).filter(i => !usedA.has(i));
  const unmatchedB = b.map((v, i) => i).filter(i => !usedB.has(i));

  const pairedA = new Set<number>();
  const pairedB = new Set<number>();

  for (const ia of unmatchedA) {
    const va = a[ia];
    if (!isPlainObj(va) && !Array.isArray(va)) continue;
    // Find best match in B: same type, fewest differences
    let bestIb = -1;
    let bestScore = Infinity;
    for (const ib of unmatchedB) {
      if (pairedB.has(ib)) continue;
      const vb = b[ib];
      const sameType =
        (isPlainObj(va) && isPlainObj(vb)) ||
        (Array.isArray(va) && Array.isArray(vb));
      if (!sameType) continue;
      // Simple similarity heuristic: count of matching top-level keys or elements
      let score = 0;
      if (isPlainObj(va) && isPlainObj(vb)) {
        const keysA = Object.keys(va);
        const keysB = new Set(Object.keys(vb));
        score = keysA.filter(k => !keysB.has(k)).length + [...keysB].filter(k => !keysA.includes(k)).length;
      } else if (Array.isArray(va) && Array.isArray(vb)) {
        score = Math.abs(va.length - vb.length);
      }
      if (score < bestScore) { bestScore = score; bestIb = ib; }
    }
    if (bestIb !== -1) {
      pairedA.add(ia);
      pairedB.add(bestIb);
      const n = deepDiff(va, b[bestIb], `${path}[${ia}]`);
      diffs.added.push(...n.added);
      diffs.removed.push(...n.removed);
      diffs.changed.push(...n.changed);
      diffs.same.push(...n.same);
    }
  }

  // Pass 3: remaining unmatched → removed / added
  for (const ia of unmatchedA) {
    if (!pairedA.has(ia))
      diffs.removed.push({ path: `${path}[${ia}]`, value: a[ia] });
  }
  for (const ib of unmatchedB) {
    if (!pairedB.has(ib))
      diffs.added.push({ path: `${path}[${ib}]`, value: b[ib] });
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

  if (sortKey(a) !== sortKey(b))
    diffs.changed.push({ path: path || "(root)", from: a, to: b });
  else
    diffs.same.push({ path: path || "(root)", value: a });

  return diffs;
}

// ─── UI Helpers

// ─── UI Helpers ────────────────────────────────────────────────────────────────

function ValueDisplay({ value }: { value: unknown }) {
  if (value === null) return <span className="italic">null</span>;
  if (value === undefined) return <span className="italic">undefined</span>;
  if (typeof value === "boolean") return <span className="font-mono">{value.toString()}</span>;
  if (typeof value === "number") return <span className="font-mono">{value}</span>;
  if (typeof value === "string") return <span className="font-mono">"{value}"</span>;
  if (Array.isArray(value)) return <span className="font-mono">[{value.length} elem.]</span>;
  if (isPlainObj(value))
    return <span className="font-mono">{"{"} {Object.keys(value).length} chei{"}"}</span>;
  return <span className="font-mono">{JSON.stringify(value)}</span>;
}

function DiffRow({ type, path, from, to, value }: DiffItem) {
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
      badge: "bg-red-950 text-red-400 border-red-700",
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
    <div className={cn("flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-mono", cfg.bg, cfg.border)}>
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
          <span className="line-through opacity-70"><ValueDisplay value={from} /></span>
          <ChevronRight size={11} />
          <ValueDisplay value={to} />
        </div>
      )}
      {(type === "added" || type === "removed" || type === "same") && (
        <div className="shrink-0"><ValueDisplay value={value} /></div>
      )}
    </div>
  );
}

// ─── Duplicates Alert ──────────────────────────────────────────────────────────

function DuplicatesAlert({ label, duplicates }: { label: string; duplicates: DuplicateEntry[] }) {
  if (!duplicates.length) return null;
  return (
    <Alert variant="destructive" className="bg-red-950/40 border-red-500/30 text-red-300 w-full">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="font-bold">Duplicate în {label}</AlertTitle>
      <AlertDescription>
        <div className="mt-2 space-y-1.5">
          {duplicates.map((dup, idx) => (
            <p key={idx} className="text-sm flex items-center gap-2">
              <Badge variant="outline" className="font-mono border-red-500/40 text-red-300">
                {JSON.stringify(dup.item)}
              </Badge>
              <span className="text-xs text-red-400/70">apare de {dup.count} ori</span>
            </p>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ArrayDiffChecker() {
  const [array1, setArray1] = useState<string>("");
  const [array2, setArray2] = useState<string>("");
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [showSame, setShowSame] = useState<boolean>(false);

  /** Detectează ghilimele simple în afara string-urilor deja cu ghilimele duble */
  const hasSingleQuotes = useCallback((val: string) => /(?<![\\])'/.test(val), []);

  /** Înlocuiește ghilimelele simple cu duble, grijă la cele escape-uite */
  const replaceSingleQuotes = useCallback((val: string) => val.replace(/(?<!\\)'/g, '"'), []);

  const analyzeArrays = useCallback(() => {
    setError(null);
    setResults(null);
    try {
      const arr1 = safeParse(array1);
      const arr2 = safeParse(array2);

      // Use canonical sort keys for set/identity checks (order-independent)
      const set1 = new Set(arr1.map(sortKey));
      const set2 = new Set(arr2.map(sortKey));

      setResults({
        length1: arr1.length,
        length2: arr2.length,
        uniqueLength1: set1.size,
        uniqueLength2: set2.size,
        duplicates1: findDuplicates(arr1),
        duplicates2: findDuplicates(arr2),
        areIdentical: arraysAreIdentical(arr1, arr2),
        sameUniqueElements: sameUniqueSet(arr1, arr2),
        diff: deepDiff(arr1, arr2),
      });
      setActiveTab("all");
      setShowSame(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [array1, array2]);

  const copyToClipboard = useCallback(
    (data: unknown) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)),
    []
  );

  const diff = results?.diff;

  const tabs: TabConfig[] = diff
    ? [
      { id: "all", label: "Toate", count: diff.added.length + diff.removed.length + diff.changed.length },
      { id: "changed", label: "Modificate", count: diff.changed.length },
      { id: "added", label: "Adăugate", count: diff.added.length },
      { id: "removed", label: "Eliminate", count: diff.removed.length },
      { id: "same", label: "Identice", count: diff.same.length },
    ]
    : [];

  const visibleItems: DiffItem[] = diff
    ? activeTab === "same"
      ? diff.same.map((d) => ({ type: "same" as DiffType, ...d }))
      : activeTab === "changed"
        ? diff.changed.map((d) => ({ type: "changed" as DiffType, ...d }))
        : activeTab === "added"
          ? diff.added.map((d) => ({ type: "added" as DiffType, ...d }))
          : activeTab === "removed"
            ? diff.removed.map((d) => ({ type: "removed" as DiffType, ...d }))
            : [
              ...diff.changed.map((d) => ({ type: "changed" as DiffType, ...d })),
              ...diff.added.map((d) => ({ type: "added" as DiffType, ...d })),
              ...diff.removed.map((d) => ({ type: "removed" as DiffType, ...d })),
              ...(showSame ? diff.same.map((d) => ({ type: "same" as DiffType, ...d })) : []),
            ]
    : [];

  return (
    <Card className="min-h-auto" style={{ fontFamily: "'IBM Plex Mono','Fira Code','Courier New',monospace" }}>
      <CardHeader className="space-y-6">
        <CardTitle className="border-b border-slate-800 pb-4">
          <h1 className="text-lg font-black tracking-tight">
            <span className="text-cyan-400">arr</span>
            <span className="text-slate-600">.</span>
            <span className="text-emerald-400">diff</span>
            <span className="text-slate-600">()</span>
          </h1>
          <CardDescription className="text-[1rem] mt-0.5">
            Compară două array-uri JSON — duplicate, elemente unice, egalitate
          </CardDescription>
        </CardTitle>
      </CardHeader>

      <CardContent className="max-w-6xl mx-auto p-6 space-y-5">
        {/* Input panels */}
        <div className="grid md:grid-cols-2 gap-4">
          {(["Array 1", "Array 2"] as const).map((label, idx) => {
            const value = idx === 0 ? array1 : array2;
            const setter = idx === 0 ? setArray1 : setArray2;
            const accent = idx === 0
              ? "border-cyan-500/30 focus-within:border-cyan-500/60"
              : "border-violet-500/30 focus-within:border-violet-500/60";
            const titleColor = idx === 0 ? "text-cyan-400" : "text-violet-400";
            const hasQuotes = hasSingleQuotes(value);
            return (
              <Card key={label} className={cn("transition-colors", accent.split(" ")[1])}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className={cn("text-sm font-black tracking-wider", titleColor)}>{label}</CardTitle>
                    {hasQuotes && (
                      <button
                        onClick={() => { setter(replaceSingleQuotes(value)); setResults(null); }}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider border transition-all animate-pulse",
                          idx === 0
                            ? "bg-cyan-950/60 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/80 hover:animate-none"
                            : "bg-violet-950/60 border-violet-500/50 text-violet-300 hover:bg-violet-900/80 hover:animate-none"
                        )}
                      >
                        <span className="font-mono text-xs">'→"</span>
                        <span className="ml-0.5">ÎNLOCUIEȘTE</span>
                      </button>
                    )}
                  </div>
                  <CardDescription>Array JSON valid</CardDescription>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className={cn("rounded-lg border transition-colors", accent)}>
                    <Textarea
                      value={value}
                      onChange={(e) => { setter(e.target.value); setResults(null); }}
                      onBlur={(e) => { setter(e.target.value.trim()); }}
                      placeholder='["item1", "item2", "item3"]'
                      className="min-h-56 border-0 bg-transparent font-mono text-sm resize-none focus-visible:ring-0 focus-visible:ring-offset-0 leading-relaxed"
                      spellCheck={false}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Analyze button */}
        <Button
          onClick={analyzeArrays}
          disabled={!array1.trim() || !array2.trim()}
          className="w-full py-6 text-sm tracking-widest rounded-xl transition-all"
        >
          ANALIZEAZĂ DIFERENȚELE
        </Button>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="bg-red-950/60 border-red-500/40 text-red-400">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Eroare de parsare</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {results && diff && (
          <CardFooter className="space-y-4 flex flex-col items-stretch p-0">

            {/* ── Equality verdict ── */}
            {results.areIdentical ? (
              <Alert className="bg-emerald-950/40 border-emerald-500/30">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <AlertTitle className="text-emerald-400 font-bold">Array-urile sunt identice ✓</AlertTitle>
                <AlertDescription className="text-slate-400">
                  {results.length1} elemente — aceleași valori.
                </AlertDescription>
              </Alert>
            ) : results.sameUniqueElements ? (
              <Alert className="bg-amber-950/40 border-amber-500/30">
                <Equal className="h-4 w-4 text-amber-400" />
                <AlertTitle className="text-amber-400 font-bold">Aceleași elemente unice, dar nu identice</AlertTitle>
                <AlertDescription className="text-slate-400">Diferă prin numărul de duplicate.</AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-red-950/40 border-red-500/30">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertTitle className="text-red-400 font-bold">Array-urile sunt diferite</AlertTitle>
                <AlertDescription className="text-slate-400">
                  Există elemente prezente în unul dar nu în celălalt.
                </AlertDescription>
              </Alert>
            )}

            <Separator className="bg-slate-800" />

            {/* ── Stats ── */}
            <div className="grid md:grid-cols-2 gap-4 w-full">
              {(["Array 1", "Array 2"] as const).map((label, idx) => {
                const length = idx === 0 ? results.length1 : results.length2;
                const unique = idx === 0 ? results.uniqueLength1 : results.uniqueLength2;
                const color = idx === 0 ? "text-cyan-400" : "text-violet-400";
                return (
                  <Card key={label} className="border-slate-800">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className={cn("text-sm font-black", color)}>{label}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">Lungime totală</span>
                        <Badge variant="default" className="font-mono">{length}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">Elemente unice</span>
                        <Badge variant="secondary" className="font-mono">{unique}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* ── Duplicates ── */}
            <DuplicatesAlert label="Array 1" duplicates={results.duplicates1} />
            <DuplicatesAlert label="Array 2" duplicates={results.duplicates2} />

            {/* ── Diff section (only when not identical) ── */}
            {!results.areIdentical && (
              <>
                <Separator className="bg-slate-800" />

                <div className="flex gap-3 text-xs font-bold font-mono flex-wrap">
                  <span className="text-amber-400">{diff.changed.length} modificate</span>
                  <Separator orientation="vertical" className="h-4 bg-slate-700" />
                  <span className="text-emerald-400">{diff.added.length} adăugate</span>
                  <Separator orientation="vertical" className="h-4 bg-slate-700" />
                  <span className="text-red-400">{diff.removed.length} eliminate</span>
                  <Separator orientation="vertical" className="h-4 bg-slate-700" />
                  <span className="text-slate-500">{diff.same.length} identice</span>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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

                <div className="flex justify-end w-full">
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

                <div className="space-y-1.5 w-full">
                  {visibleItems.length === 0 ? (
                    <p className="text-center text-sm py-10">Nicio diferență în această categorie.</p>
                  ) : (
                    visibleItems.map((item, i) => <DiffRow key={i} {...item} />)
                  )}
                </div>

                {activeTab === "all" && diff.same.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSame((s) => !s)}
                    className="flex items-center gap-2 text-xs mx-auto"
                  >
                    {showSame ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {showSame ? "Ascunde" : "Arată"} {diff.same.length} elemente identice
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