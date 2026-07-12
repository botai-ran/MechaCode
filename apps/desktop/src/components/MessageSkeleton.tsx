import { memo } from "react";
import { Skeleton } from "./Skeleton";

type MessageSkeletonProps = {
  role: "user" | "assistant";
};

export const MessageSkeleton = memo(function MessageSkeleton({
  role
}: MessageSkeletonProps) {
  return (
    <div className={`message-skeleton is-${role}`}>
      <Skeleton width="40px" height="16px" />
      <Skeleton width="60%" height="20px" />
      <Skeleton width="40%" height="20px" />
    </div>
  );
});
