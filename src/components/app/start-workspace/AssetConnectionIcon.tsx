import { inferConnectionIconKeyFromRemoteSystem, resolveConnectionIcon } from "@/components/icons";
import type { SavedConnection } from "@/types/global";

interface AssetConnectionIconProps {
  connection: SavedConnection;
  selected?: boolean;
  className?: string;
}

export default function AssetConnectionIcon({
  connection,
  selected = false,
  className = "",
}: AssetConnectionIconProps) {
  const iconDef = resolveAssetConnectionIcon(connection);
  const Icon = iconDef.icon;

  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded border ${className}`}
      style={{
        borderColor: selected
          ? "color-mix(in srgb, var(--df-primary) 46%, transparent)"
          : "color-mix(in srgb, var(--df-border) 72%, transparent)",
        backgroundColor: selected
          ? "color-mix(in srgb, var(--df-primary) 12%, transparent)"
          : "color-mix(in srgb, var(--df-bg-hover) 42%, transparent)",
        color: selected ? "var(--df-primary)" : iconDef.color,
      }}
    >
      <Icon className="size-4 max-h-4 max-w-4" aria-hidden="true" />
    </span>
  );
}

function resolveAssetConnectionIcon(connection: SavedConnection) {
  const os = [connection.asset?.os_name, connection.asset?.os_version]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  const inferredIcon = inferConnectionIconKeyFromRemoteSystem({
    os,
    arch: connection.asset?.architecture ?? "",
  });

  return inferredIcon
    ? resolveConnectionIcon(inferredIcon)
    : resolveConnectionIcon(connection.icon);
}
