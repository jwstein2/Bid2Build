import { newGroup, newLineItem, uid } from "@/lib/estimate/factory";
import type { Estimate, EstimateGroup, LineItem, PricingRule } from "@/lib/estimate/types";
import type { TemplateItem } from "@/lib/trades/catalog";

export type Trash =
  | { kind: "item"; item: LineItem; label: string }
  | { kind: "group"; group: EstimateGroup; items: LineItem[]; label: string }
  | { kind: "items"; items: LineItem[]; label: string };

export type Action =
  | { type: "replace"; estimate: Estimate }
  | { type: "patch"; patch: Partial<Estimate> }
  | { type: "patchCustomer"; patch: Partial<Estimate["customer"]> }
  | { type: "patchLocation"; patch: Partial<Estimate["location"]> }
  | { type: "addItem"; groupId: string; from?: Partial<TemplateItem> & Partial<LineItem>; afterId?: string; newId?: string }
  | { type: "addItems"; groupId: string; items: (Partial<TemplateItem> & Partial<LineItem>)[] }
  | { type: "updateItem"; id: string; patch: Partial<LineItem> }
  | { type: "deleteItem"; id: string }
  | { type: "deleteItems"; ids: string[] }
  | { type: "duplicateItem"; id: string }
  | { type: "moveItem"; id: string; dir: -1 | 1 }
  | { type: "moveItemToGroup"; id: string; groupId: string }
  | { type: "bulkOverride"; ids: string[]; rule: PricingRule | null }
  | { type: "addGroup"; name?: string }
  | { type: "updateGroup"; id: string; patch: Partial<EstimateGroup> }
  | { type: "deleteGroup"; id: string }
  | { type: "moveGroup"; id: string; dir: -1 | 1 }
  | { type: "undo" };

export interface State {
  estimate: Estimate;
  trash: Trash[];
  dirty: number; // increments on every change; used by autosave
}

const renumber = <T extends { sortOrder: number }>(arr: T[]): T[] => arr.map((x, i) => (x.sortOrder === i ? x : { ...x, sortOrder: i }));

function groupItems(e: Estimate, groupId: string) {
  return e.items.filter((i) => i.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder);
}

function setGroupItems(e: Estimate, groupId: string, ordered: LineItem[]): Estimate {
  const others = e.items.filter((i) => i.groupId !== groupId);
  return { ...e, items: [...others, ...renumber(ordered)] };
}

export function reducer(state: State, action: Action): State {
  const e = state.estimate;
  const next = (estimate: Estimate, trash = state.trash): State => ({ estimate, trash, dirty: state.dirty + 1 });

  switch (action.type) {
    case "replace":
      return { estimate: action.estimate, trash: [], dirty: state.dirty };
    case "patch":
      return next({ ...e, ...action.patch });
    case "patchCustomer":
      return next({ ...e, customer: { ...e.customer, ...action.patch } });
    case "patchLocation":
      return next({ ...e, location: { ...e.location, ...action.patch } });
    case "addItem": {
      const list = groupItems(e, action.groupId);
      const idx = action.afterId ? list.findIndex((i) => i.id === action.afterId) + 1 : list.length;
      const item = { ...newLineItem(action.groupId, 0, action.from), ...(action.newId ? { id: action.newId } : {}) };
      list.splice(idx, 0, item);
      return next(setGroupItems(e, action.groupId, list));
    }
    case "addItems": {
      const list = groupItems(e, action.groupId);
      for (const f of action.items) list.push(newLineItem(action.groupId, 0, f));
      return next(setGroupItems(e, action.groupId, list));
    }
    case "updateItem":
      return next({ ...e, items: e.items.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)) });
    case "deleteItem": {
      const found = e.items.find((i) => i.id === action.id);
      if (!found) return state;
      const position = groupItems(e, found.groupId).findIndex((i) => i.id === found.id);
      const item = { ...found, sortOrder: position };
      const without = { ...e, items: e.items.filter((i) => i.id !== action.id) };
      const rest = setGroupItems(without, item.groupId, groupItems(without, item.groupId));
      return next(rest, [...state.trash, { kind: "item" as const, item, label: item.name || "item" }].slice(-20));
    }
    case "deleteItems": {
      const ids = new Set(action.ids);
      const removed = e.items.filter((i) => ids.has(i.id));
      if (!removed.length) return state;
      return next({ ...e, items: e.items.filter((i) => !ids.has(i.id)) }, [...state.trash, { kind: "items", items: removed, label: `${removed.length} items` } as Trash].slice(-20));
    }
    case "duplicateItem": {
      const src = e.items.find((i) => i.id === action.id);
      if (!src) return state;
      const list = groupItems(e, src.groupId);
      const idx = list.findIndex((i) => i.id === src.id);
      list.splice(idx + 1, 0, { ...src, id: uid(), name: src.name ? `${src.name} (copy)` : "" });
      return next(setGroupItems(e, src.groupId, list));
    }
    case "moveItem": {
      const src = e.items.find((i) => i.id === action.id);
      if (!src) return state;
      const list = groupItems(e, src.groupId);
      const idx = list.findIndex((i) => i.id === src.id);
      const to = idx + action.dir;
      if (to < 0 || to >= list.length) return state;
      [list[idx], list[to]] = [list[to], list[idx]];
      return next(setGroupItems(e, src.groupId, list));
    }
    case "moveItemToGroup": {
      const src = e.items.find((i) => i.id === action.id);
      if (!src || src.groupId === action.groupId) return state;
      const target = groupItems(e, action.groupId);
      const moved = { ...src, groupId: action.groupId, sortOrder: target.length };
      const without = { ...e, items: e.items.filter((i) => i.id !== src.id) };
      const after = setGroupItems(without, src.groupId, groupItems(without, src.groupId));
      return next({ ...after, items: [...after.items, moved] });
    }
    case "bulkOverride": {
      const ids = new Set(action.ids);
      return next({ ...e, items: e.items.map((i) => (ids.has(i.id) ? { ...i, pricingOverride: action.rule } : i)) });
    }
    case "addGroup": {
      const groups = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
      groups.push(newGroup(action.name ?? "New section", groups.length));
      return next({ ...e, groups: renumber(groups) });
    }
    case "updateGroup":
      return next({ ...e, groups: e.groups.map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)) });
    case "deleteGroup": {
      const group = e.groups.find((g) => g.id === action.id);
      if (!group) return state;
      const items = e.items.filter((i) => i.groupId === group.id);
      const groups = renumber([...e.groups].filter((g) => g.id !== group.id).sort((a, b) => a.sortOrder - b.sortOrder));
      return next({ ...e, groups, items: e.items.filter((i) => i.groupId !== group.id) }, [...state.trash, { kind: "group", group, items, label: group.name || "section" } as Trash].slice(-20));
    }
    case "moveGroup": {
      const groups = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
      const idx = groups.findIndex((g) => g.id === action.id);
      const to = idx + action.dir;
      if (idx < 0 || to < 0 || to >= groups.length) return state;
      [groups[idx], groups[to]] = [groups[to], groups[idx]];
      return next({ ...e, groups: renumber(groups) });
    }
    case "undo": {
      const last = state.trash[state.trash.length - 1];
      if (!last) return state;
      const trash = state.trash.slice(0, -1);
      if (last.kind === "item") {
        const groupExists = e.groups.some((g) => g.id === last.item.groupId);
        const groupId = groupExists ? last.item.groupId : [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id;
        if (!groupId) return { ...state, trash };
        const list = groupItems(e, groupId);
        list.splice(Math.min(last.item.sortOrder, list.length), 0, { ...last.item, groupId });
        return next(setGroupItems(e, groupId, list), trash);
      }
      if (last.kind === "items") {
        const groupIds = new Set(e.groups.map((g) => g.id));
        return next({ ...e, items: [...e.items, ...last.items.filter((i) => groupIds.has(i.groupId))] }, trash);
      }
      const groups = [...e.groups].sort((a, b) => a.sortOrder - b.sortOrder);
      groups.splice(Math.min(last.group.sortOrder, groups.length), 0, last.group);
      return next({ ...e, groups: renumber(groups), items: [...e.items, ...last.items] }, trash);
    }
  }
}
