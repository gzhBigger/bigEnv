/**
 * bigEnv 标志：三层版本栈 + 一个「当前」圆点（对应 <sdk>/<version> 与 current 链接）。
 * 与 build/logo-mark.svg 同源，用 SVG 是为了在任意尺寸下保持锐利。
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="116" fill="#0c141d" />
      <rect x="14" y="14" width="484" height="484" rx="104" fill="none" stroke="#4c9aff" strokeOpacity="0.35" strokeWidth="10" />
      <rect x="112" y="150" width="288" height="58" rx="29" fill="#7dbcff" />
      <rect x="112" y="232" width="232" height="58" rx="29" fill="#4c9aff" />
      <rect x="112" y="314" width="168" height="58" rx="29" fill="#35d0a5" />
      <circle cx="356" cy="343" r="29" fill="#35d0a5" />
      <circle cx="356" cy="343" r="13" fill="#08111a" />
    </svg>
  );
}
