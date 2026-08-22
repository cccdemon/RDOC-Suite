// 22px initials square — identical to the design's avatarStyle()/AV color hash.
const AV_COLORS = ["var(--cyan)", "var(--purple)", "var(--green)", "var(--gold)", "var(--pink)"];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const initials = (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "??").toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontSize: 9,
        fontWeight: 700,
        color: "var(--bg)",
        background: avatarColor(name),
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}
