import { Chip } from "@mui/material";
import { useRecordContext } from "react-admin";

const STATUS_COLORS = {
  PENDING: "default",
  RUNNING: "primary",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "warning",
} as const;

type StatusColorKey = keyof typeof STATUS_COLORS;

interface JobStatusBadgeProps {
  source: string;
  label?: string;
}

export const JobStatusBadge = ({ source }: JobStatusBadgeProps) => {
  const record = useRecordContext<Record<string, string>>();
  const status = record?.[source] as StatusColorKey | undefined;
  const color = status ? (STATUS_COLORS[status] ?? "default") : "default";
  return <Chip label={status ?? "-"} color={color} size="small" />;
};
