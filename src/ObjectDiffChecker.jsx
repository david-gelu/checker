import React, { useState, useCallback } from "react";
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
} from "lucide-react";

// ─── Smart Parser — accepts JSON and JS object literals ───────────────────────
function smartParse(str) {
  const trimmed = str.trim();
  if (!trimmed) throw new Error("Input gol");

  // 1. Try strict JSON first
  try {
    return { value: JSON.parse(trimmed), format: "json" };
  } catch (_) {}

  // 2. Try converting JS object literal → JSON
  // Steps:
  //  a) replace single-quoted strings with double-quoted
  //  b) quote unquoted keys
  //  c) remove trailing commas
  //  d) replace undefined → null
  try {
    let s = trimmed;

    // Replace single quotes around values/keys with double quotes
    // Handle escaped single quotes inside \'
    s = s.replace(/'/g, '"');

    // Quote unquoted object keys:  word: → "word":
    s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

    // Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, "$1");

    // Replace JS undefined with null
    s = s.replace(/:\s*undefined/g, ": null");

    // Replace JS Infinity / -Infinity with null
    s = s.replace(/:\s*-?Infinity/g, ": null");

    return { value: JSON.parse(s), format: "js", fixed: s };
  } catch (_) {}

  // 3. Last resort: try eval-based parse (safe subset)
  try {
    // Wrap in parentheses so expression is valid
    // Use Function constructor to avoid direct eval scope issues
    const val = Function('"use strict"; return (' + trimmed + ")")(); // eslint-disable-line
    if (typeof val === "object" && val !== null) {
      return {
        value: val,
        format: "js-eval",
        fixed: JSON.stringify(val, null, 2),
      };
    }
    throw new Error("Nu este un obiect");
  } catch (e) {
    throw new Error(
      "Nu am putut parsa inputul nici ca JSON, nici ca obiect JS: " + e.message
    );
  }
}

function toJson(str) {
  try {
    const { fixed, value } = smartParse(str);
    return fixed || JSON.stringify(value, null, 2);
  } catch (e) {
    return null;
  }
}

function getParseStatus(str) {
  if (!str.trim()) return null;
  try {
    const result = smartParse(str);
    if (result.format === "json")
      return { ok: true, label: "JSON valid", note: null };
    if (result.format === "js" || result.format === "js-eval")
      return { ok: true, label: "JS detectat", note: "Convertit automat" };
  } catch (e) {
    return { ok: false, label: "Format invalid", note: e.message };
  }
}

// ─── Deep Diff Engine ─────────────────────────────────────────────────────────
function isPlainObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepDiff(a, b, path = "") {
  const diffs = { added: [], removed: [], changed: [], same: [] };

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

// ─── UI helpers ───────────────────────────────────────────────────────────────
function ValueDisplay({ value }) {
  if (value === null)
    return <span className="text-slate-400 italic">null</span>;
  if (value === undefined)
    return <span className="text-slate-400 italic">undefined</span>;
  if (typeof value === "boolean")
    return <span className="text-amber-400">{value.toString()}</span>;
  if (typeof value === "number")
    return <span className="text-cyan-400">{value}</span>;
  if (typeof value === "string")
    return <span className="text-emerald-400">"{value}"</span>;
  if (Array.isArray(value))
    return <span className="text-violet-400">[{value.length} elem.]</span>;
  if (isPlainObj(value))
    return (
      <span className="text-slate-300">
        {"{"}
        {Object.keys(value).length} chei{"}"}
      </span>
    );
  return <span className="text-slate-300">{JSON.stringify(value)}</span>;
}

function DiffRow({ type, path, from, to, value }) {
  const cfg = {
    added: {
      bg: "bg-emerald-950/60",
      border: "border-emerald-500/40",
      icon: <Plus size={11} className="text-emerald-400" />,
      label: "ADĂUGAT",
      lc: "text-emerald-400",
    },
    removed: {
      bg: "bg-red-950/60",
      border: "border-red-500/40",
      icon: <Minus size={11} className="text-red-400" />,
      label: "ELIMINAT",
      lc: "text-red-400",
    },
    changed: {
      bg: "bg-amber-950/60",
      border: "border-amber-500/40",
      icon: <RefreshCw size={11} className="text-amber-400" />,
      label: "MODIFICAT",
      lc: "text-amber-400",
    },
    same: {
      bg: "bg-slate-900/40",
      border: "border-slate-700/30",
      icon: <CheckCircle size={11} className="text-slate-600" />,
      label: "IDENTIC",
      lc: "text-slate-600",
    },
  }[type];

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${cfg.bg} ${cfg.border} font-mono text-sm`}
    >
      <div className="flex items-center gap-1.5 mt-0.5 shrink-0">
        {cfg.icon}
        <span className={`text-[9px] font-black tracking-widest ${cfg.lc}`}>
          {cfg.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-slate-200 font-semibold break-all">{path}</span>
        {type === "changed" && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 bg-red-950/60 px-2 py-0.5 rounded">
              <span className="text-red-400 font-bold">−</span>
              <ValueDisplay value={from} />
            </span>
            <ChevronRight size={12} className="text-slate-500" />
            <span className="flex items-center gap-1 bg-emerald-950/60 px-2 py-0.5 rounded">
              <span className="text-emerald-400 font-bold">+</span>
              <ValueDisplay value={to} />
            </span>
          </div>
        )}
        {(type === "added" || type === "removed") && (
          <div className="mt-1 text-xs">
            <ValueDisplay value={value} />
          </div>
        )}
        {type === "same" && (
          <div className="mt-1 text-xs opacity-40">
            <ValueDisplay value={value} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Input Panel ──────────────────────────────────────────────────────────────
function InputPanel({ label, accent, raw, setRaw, status }) {
  const handleAutofix = () => {
    const fixed = toJson(raw);
    if (fixed) setRaw(fixed);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label
          className={`text-xs font-black tracking-widest ${
            accent === "cyan" ? "text-cyan-400" : "text-violet-400"
          }`}
        >
          {label}
        </label>
        <div className="flex items-center gap-2">
          {/* Auto-fix button — shown when there's content and status is ok (JS detected) or even on error for best-effort */}
          {raw.trim() && (
            <button
              onClick={handleAutofix}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-slate-400 hover:text-amber-300 transition-all"
              title="Convertește în JSON valid"
            >
              <Wand2 size={10} /> Auto-fix JSON
            </button>
          )}
          {raw.trim() &&
            status &&
            (status.ok ? (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle size={10} />
                {status.label}
                {status.note && (
                  <span className="text-slate-500">({status.note})</span>
                )}
              </span>
            ) : (
              <span className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertCircle size={10} /> {status.label}
              </span>
            ))}
        </div>
      </div>
      <div
        className={`rounded-xl border transition-all ${
          !raw.trim()
            ? "border-slate-700/60"
            : status?.ok
            ? "border-emerald-500/40"
            : "border-red-500/50"
        } ${status && !status.ok ? "bg-red-950/10" : "bg-red"}`}
      >
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="w-full h-60 p-4 text-primary rounded-xl text-sm font-mono resize-none focus:outline-none bg-transparent placeholder-slate-700 leading-relaxed"
          placeholder={
            '// JSON:\n{ "key": "value", "arr": [1, 2] }\n\n// sau JS:\n{ key: \'value\', arr: [1, 2] }'
          }
          spellCheck={false}
        />
      </div>
      {raw.trim() && status && !status.ok && (
        <p className="text-xs text-red-400 flex items-start gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          {status.note}
        </p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ObjectDiffChecker() {
  const [raw1, setRaw1] = useState("");
  const [raw2, setRaw2] = useState("");
  const [results, setResults] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [showSame, setShowSame] = useState(false);

  const status1 = getParseStatus(raw1);
  const status2 = getParseStatus(raw2);

  const analyze = () => {
    setParseError(null);
    try {
      const { value: o1 } = smartParse(raw1);
      const { value: o2 } = smartParse(raw2);
      if (!isPlainObj(o1) && !Array.isArray(o1))
        throw new Error("Obiect A nu este un obiect sau array valid");
      if (!isPlainObj(o2) && !Array.isArray(o2))
        throw new Error("Obiect B nu este un obiect sau array valid");
      setResults(deepDiff(o1, o2));
      setActiveTab("all");
      setShowSame(false);
    } catch (e) {
      setParseError(e.message);
      setResults(null);
    }
  };

  const copyToClipboard = (data) =>
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));

  const isIdentical =
    results &&
    !results.added.length &&
    !results.removed.length &&
    !results.changed.length;

  const tabs = results
    ? [
        {
          id: "all",
          label: "Toate",
          count:
            results.added.length +
            results.removed.length +
            results.changed.length,
        },
        { id: "changed", label: "Modificate", count: results.changed.length },
        { id: "added", label: "Adăugate", count: results.added.length },
        { id: "removed", label: "Eliminate", count: results.removed.length },
        { id: "same", label: "Identice", count: results.same.length },
      ]
    : [];

  const visibleItems = results
    ? activeTab === "same"
      ? results.same.map((d) => ({ type: "same", ...d }))
      : activeTab === "changed"
      ? results.changed.map((d) => ({ type: "changed", ...d }))
      : activeTab === "added"
      ? results.added.map((d) => ({ type: "added", ...d }))
      : activeTab === "removed"
      ? results.removed.map((d) => ({ type: "removed", ...d }))
      : [
          ...results.changed.map((d) => ({ type: "changed", ...d })),
          ...results.added.map((d) => ({ type: "added", ...d })),
          ...results.removed.map((d) => ({ type: "removed", ...d })),
          ...(showSame
            ? results.same.map((d) => ({ type: "same", ...d }))
            : []),
        ]
    : [];

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6"
      style={{
        fontFamily: "'IBM Plex Mono','Fira Code','Courier New',monospace",
      }}
    >
      {/* Header */}
      <div className="border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-black tracking-tight">
              <span className="text-cyan-400">obj</span>
              <span className="text-slate-600">.</span>
              <span className="text-emerald-400">diff</span>
              <span className="text-slate-600">()</span>
            </h1>
            <p className="text-[10px] text-gray-800 mt-0.5">
              Acceptă JSON și obiecte JS — deep compare, nested + arrays
            </p>
          </div>
          {results && !isIdentical && (
            <div className="flex gap-4 text-xs font-bold">
              <span className="text-amber-400">
                {results.changed.length} modificate
              </span>
              <span className="text-emerald-400">
                {results.added.length} adăugate
              </span>
              <span className="text-red-400">
                {results.removed.length} eliminate
              </span>
              <span className="text-slate-500">
                {results.same.length} identice
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <InputPanel
            label="Obiect A"
            accent="cyan"
            raw={raw1}
            setRaw={(v) => {
              setRaw1(v);
              setResults(null);
            }}
            status={status1}
          />
          <InputPanel
            label="Obiect B"
            accent="violet"
            raw={raw2}
            setRaw={(v) => {
              setRaw2(v);
              setResults(null);
            }}
            status={status2}
          />
        </div>

        {/* Format hint */}
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-600 px-1">
          <span className="text-slate-500 font-bold">Formate acceptate:</span>
          <span>
            JSON standard{" "}
            <span className="text-slate-700">{'{ "key": "val" }'}</span>
          </span>
          <span>•</span>
          <span>
            JS object <span className="text-slate-700">{"{ key: 'val' }"}</span>
          </span>
          <span>•</span>
          <span>
            Ghilimele simple <span className="text-slate-700">{"'val'"}</span>
          </span>
          <span>•</span>
          <span>Chei fără ghilimele</span>
        </div>

        <button
          onClick={analyze}
          disabled={!raw1.trim() || !raw2.trim()}
          className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-900 font-black text-sm tracking-widest rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/20"
        >
          ANALIZEAZĂ DIFERENȚELE
        </button>

        {parseError && (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-400 text-sm">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            {parseError}
          </div>
        )}

        {results && (
          <div className="space-y-4">
            {isIdentical ? (
              <div className="flex items-center gap-3 p-5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl">
                <CheckCircle className="text-emerald-400 shrink-0" size={22} />
                <div>
                  <p className="font-bold text-emerald-400">
                    Obiectele sunt identice ✓
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {results.same.length} proprietăți comparate — nicio
                    diferență
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold tracking-wide whitespace-nowrap transition-all ${
                        activeTab === tab.id
                          ? "bg-slate-700 text-white"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {tab.label}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          activeTab === tab.id ? "bg-slate-600" : "bg-slate-800"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => copyToClipboard(visibleItems)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-all"
                  >
                    <Copy size={11} /> Copiază rezultatele
                  </button>
                </div>

                <div className="space-y-1.5">
                  {visibleItems.length === 0 ? (
                    <p className="text-center text-slate-600 text-sm py-10">
                      Nicio diferență în această categorie.
                    </p>
                  ) : (
                    visibleItems.map((item, i) => <DiffRow key={i} {...item} />)
                  )}
                </div>

                {activeTab === "all" && results.same.length > 0 && (
                  <button
                    onClick={() => setShowSame((s) => !s)}
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-all mx-auto pt-1"
                  >
                    {showSame ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    {showSame ? "Ascunde" : "Arată"} {results.same.length}{" "}
                    proprietăți identice
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
