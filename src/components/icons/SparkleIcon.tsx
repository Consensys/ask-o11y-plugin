import React from 'react';

export interface SparkleIconProps {
  /** Size of the icon in pixels. Defaults to 24. */
  size?: number;
  /** Color of the icon. Defaults to "currentColor" for CSS inheritance. */
  color?: string;
  /** Opacity of the icon fill. Defaults to 1. */
  opacity?: number;
  /** Additional CSS class names (e.g., for animations). */
  className?: string;
  /** Additional inline styles. */
  style?: React.CSSProperties;
}

/**
 * Sparkle SVG icon component matching Grafana's style.
 * Used across the app for decorative emphasis.
 */
export const SparkleIcon: React.FC<SparkleIconProps> = ({
  size = 24,
  color = 'currentColor',
  opacity = 1,
  className,
  style,
}) => (
  <svg
    className={className}
    style={style}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z"
      fill={color}
      opacity={opacity}
    />
  </svg>
);
