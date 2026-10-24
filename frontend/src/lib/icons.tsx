import {
  Ban,
  Boxes,
  Braces,
  FileCode2,
  Network,
  Package,
  Route,
  Unplug,
  Variable,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** One icon per finding type, reused by tiles, tables and the dashboard. */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  unused_function: Braces,
  unused_class: Boxes,
  unused_method: Wrench,
  unused_variable: Variable,
  unused_import: Unplug,
  unused_module: FileCode2,
  unused_dependency: Package,
  unused_route: Route,
  unreachable_code: Ban,
};

/** Graph node kinds (a superset of finding types). */
export const KIND_ICONS: Record<string, LucideIcon> = {
  module: FileCode2,
  function: Braces,
  class: Boxes,
  method: Wrench,
  variable: Variable,
  import: Unplug,
  route: Route,
  router: Network,
  fastapi_app: Zap,
  distribution: Package,
};

export const typeIcon = (type: string): LucideIcon => TYPE_ICONS[type] ?? Braces;
export const kindIcon = (kind: string): LucideIcon => KIND_ICONS[kind] ?? Braces;

/** Plural noun used in summary tiles ("73 unused functions"). */
export const TILE_LABELS: Record<string, string> = {
  unused_function: "unused functions",
  unused_class: "unused classes",
  unused_method: "unused methods",
  unused_variable: "unused variables",
  unused_import: "unused imports",
  unused_module: "unused modules",
  unused_dependency: "unused dependencies",
  unused_route: "probably unused APIs",
  unreachable_code: "unreachable blocks",
};
