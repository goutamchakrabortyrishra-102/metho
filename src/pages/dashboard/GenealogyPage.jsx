import React, { useEffect, useState, useRef, useMemo } from "react";
import api from "@/services/api";
import Tree from "react-d3-tree";
import { Users, Award, Network, Maximize2, ZoomIn, ZoomOut, RotateCcw, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

function toD3(node) {
  if (!node) return null;
  return {
    name: node.name || node.member_code || "—",
    attributes: {
      code: node.member_code || "",
      rank: node.rank || "Starter",
    },
    _id: node.id,
    children: (node.children || []).map(toD3),
  };
}

function countNodes(n) {
  if (!n) return 0;
  const kids = n.children || [];
  return 1 + kids.reduce((s, c) => s + countNodes(c), 0);
}
function maxDepth(n, d = 0) {
  if (!n) return d;
  const kids = n.children || [];
  if (kids.length === 0) return d + 1;
  return Math.max(...kids.map(c => maxDepth(c, d + 1)));
}
function flatten(node, level, parentKey, out) {
  if (!node) return;
  const key = parentKey + "/" + (node.id || node.member_code);
  out.push({ key, id: node.id, name: node.name, member_code: node.member_code, rank: node.rank, level, child_count: (node.children || []).length });
  for (const c of (node.children || [])) flatten(c, level + 1, key, out);
}

const RANK_COLORS = {
  Diamond: "#0ea5e9",
  Gold: "#d97706",
  Silver: "#64748b",
  Bronze: "#a16207",
  Starter: "#065f46",
};

const NodeCard = ({ nodeDatum, toggleNode }) => {
  const rank = nodeDatum.attributes?.rank || "Starter";
  const color = RANK_COLORS[rank] || RANK_COLORS.Starter;
  const hasChildren = (nodeDatum.children || []).length > 0 || (nodeDatum._children || []).length > 0;
  return (
    <g>
      <foreignObject x="-90" y="-35" width="180" height="70" style={{ overflow: "visible" }}>
        <div
          onClick={() => hasChildren && toggleNode()}
          style={{
            border: `2px solid ${color}`,
            borderRadius: 12,
            background: "#ffffff",
            padding: "8px 10px",
            cursor: hasChildren ? "pointer" : "default",
            boxShadow: "0 6px 14px -6px rgba(15,23,42,.25)",
            fontFamily: "inherit",
          }}
        >
          <div style={{ fontSize: 9, letterSpacing: 1, color, fontWeight: 800, textTransform: "uppercase" }}>
            {nodeDatum.attributes?.code || rank}
          </div>
          <div style={{ fontSize: 13, color: "#052e29", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {nodeDatum.name}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, display: "flex", justifyContent: "space-between" }}>
            <span>{rank}</span>
            {hasChildren && <span style={{ color, fontWeight: 700 }}>{(nodeDatum.children || nodeDatum._children || []).length} ↓</span>}
          </div>
        </div>
      </foreignObject>
    </g>
  );
};

export default function GenealogyPage() {
  const { user } = useAuth();
  const [tree, setTree] = useState(null);
  const [view, setView] = useState("tree"); // 'tree' | 'list'
  const [zoom, setZoom] = useState(0.8);
  const [translate, setTranslate] = useState({ x: 300, y: 80 });
  const wrapRef = useRef(null);
  const [orientation, setOrientation] = useState("vertical");

  useEffect(() => {
    api.get("/genealogy/tree").then(r => setTree(r.data)).catch(() => setTree({ id: "", name: user?.name || "You", children: [] }));
  }, [user]);

  useEffect(() => {
    if (wrapRef.current) {
      const { width } = wrapRef.current.getBoundingClientRect();
      setTranslate({ x: width / 2, y: 80 });
    }
  }, [wrapRef.current, view]);

  const d3Tree = useMemo(() => toD3(tree), [tree]);
  const totalNodes = tree ? countNodes(tree) - 1 : 0; // exclude self
  const depth = tree ? maxDepth(tree) - 1 : 0;
  const directs = tree?.children?.length || 0;

  const list = useMemo(() => {
    const out = [];
    if (tree) flatten(tree, 0, "", out);
    return out.slice(1); // exclude self
  }, [tree]);

  if (!tree) return <div className="text-slate-500">Loading team tree...</div>;

  return (
    <div className="space-y-6" data-testid="genealogy-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Team Network</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Genealogy Tree</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">Your downline visualised — click any node to collapse/expand children.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={view === "tree" ? "default" : "outline"} onClick={() => setView("tree")} className={view === "tree" ? "bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" : "rounded-full"} data-testid="view-tree">
            <Network className="w-3.5 h-3.5 mr-1" /> Tree
          </Button>
          <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} className={view === "list" ? "bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" : "rounded-full"} data-testid="view-list">
            <List className="w-3.5 h-3.5 mr-1" /> List
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Direct Members</p><p className="font-display font-black text-2xl text-emerald-950">{directs}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Total Downline</p><p className="font-display font-black text-2xl text-emerald-950">{totalNodes}</p></div>
        <div className="bg-white rounded-xl border border-border p-4"><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Depth</p><p className="font-display font-black text-2xl text-emerald-950">{depth} <span className="text-xs font-normal text-slate-500">level{depth !== 1 ? "s" : ""}</span></p></div>
      </div>

      {view === "tree" ? (
        <div ref={wrapRef} className="relative bg-gradient-to-b from-slate-50 to-white rounded-xl border border-border overflow-hidden" style={{ height: 620 }} data-testid="tree-canvas">
          {/* Controls */}
          <div className="absolute top-3 right-3 z-10 flex gap-1 bg-white/90 backdrop-blur rounded-full border border-border p-1">
            <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} className="w-8 h-8 rounded-full hover:bg-emerald-50 flex items-center justify-center" data-testid="zoom-in"><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoom(z => Math.max(0.25, z - 0.15))} className="w-8 h-8 rounded-full hover:bg-emerald-50 flex items-center justify-center" data-testid="zoom-out"><ZoomOut className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setZoom(0.8); if (wrapRef.current) { const { width } = wrapRef.current.getBoundingClientRect(); setTranslate({ x: width / 2, y: 80 }); } }} className="w-8 h-8 rounded-full hover:bg-emerald-50 flex items-center justify-center" data-testid="zoom-reset"><RotateCcw className="w-3.5 h-3.5" /></button>
            <button onClick={() => setOrientation(o => o === "vertical" ? "horizontal" : "vertical")} className="w-8 h-8 rounded-full hover:bg-emerald-50 flex items-center justify-center" data-testid="toggle-orientation"><Maximize2 className="w-3.5 h-3.5" /></button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 flex gap-3 text-[10px]">
            {Object.entries(RANK_COLORS).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: v }} /><span className="font-semibold text-slate-700">{k}</span></div>
            ))}
          </div>

          {directs === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <Users className="w-12 h-12 text-emerald-200" />
              <p className="mt-3 font-display font-bold text-emerald-950">No downline yet</p>
              <p className="text-sm text-slate-500 mt-1 max-w-sm font-body">Share your referral link (Overview page) to invite members — they'll appear here.</p>
            </div>
          ) : (
            <Tree
              data={d3Tree}
              orientation={orientation}
              translate={translate}
              zoom={zoom}
              zoomable={true}
              collapsible={true}
              renderCustomNodeElement={NodeCard}
              nodeSize={{ x: 220, y: orientation === "vertical" ? 110 : 220 }}
              separation={{ siblings: 1, nonSiblings: 1.4 }}
              pathFunc="step"
              pathClassFunc={() => "genealogy-link"}
            />
          )}
          <style>{`.genealogy-link { stroke: #10b981; stroke-width: 1.5; fill: none; opacity: .5; }`}</style>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Level</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Member</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Code</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700 text-xs uppercase">Rank</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700 text-xs uppercase">Downline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.length === 0 ? (
                <tr><td colSpan="5" className="px-3 py-8 text-center text-muted-foreground">No downline yet.</td></tr>
              ) : list.map((n, i) => (
                <tr key={n.key} data-testid={`downline-row-${i}`} className="hover:bg-secondary/30">
                  <td className="px-3 py-2 text-xs text-slate-500 font-mono">L{n.level}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-950" style={{ paddingLeft: `${12 + (n.level - 1) * 16}px` }}>{n.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 font-mono">{n.member_code}</td>
                  <td className="px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: `${RANK_COLORS[n.rank] || RANK_COLORS.Starter}20`, color: RANK_COLORS[n.rank] || RANK_COLORS.Starter }}>{n.rank || "Starter"}</span></td>
                  <td className="px-3 py-2 text-right text-slate-700">{n.child_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

