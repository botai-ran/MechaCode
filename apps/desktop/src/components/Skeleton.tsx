import { memo } from "react";

type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  variant?: "text" | "circle" | "rect";
  style?: React.CSSProperties;
};

export const Skeleton = memo(function Skeleton({
  width = "100%",
  height = 16,
  variant = "text",
  style
}: SkeletonProps) {
  return (
    <div
      className={`skeleton skeleton--${variant}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
});
