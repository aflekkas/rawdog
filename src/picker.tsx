import React from "react";
import { Box, Text } from "ink";

const PINK = "#ff5fc8";

export type PickerItem = {
  key: string;
  label: string;
  description?: string;
  hint?: string;
  disabled?: boolean;
};

export type PickerProps = {
  title: string;
  subtitle?: string;
  items: PickerItem[];
  selected: number;
  emptyText?: string;
  hintFooter?: string;
  columns: number;
  rows: number;
  accent?: string;
};

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + "…";
}

export function Picker({
  title,
  subtitle,
  items,
  selected,
  emptyText,
  hintFooter,
  columns,
  rows,
  accent = PINK,
}: PickerProps) {
  const visibleRows = Math.max(4, Math.min(20, rows - 9));
  const safeSel = items.length === 0 ? 0 : Math.max(0, Math.min(items.length - 1, selected));
  const half = Math.floor(visibleRows / 2);
  let scroll = Math.max(0, safeSel - half);
  scroll = Math.min(scroll, Math.max(0, items.length - visibleRows));
  const visible = items.slice(scroll, scroll + visibleRows);

  // Reserve roughly half the width for labels, leave the other half for description.
  // Both are single-line (truncated with ellipsis) so the picker stays one row per item
  // regardless of terminal width.
  const inner = Math.max(20, columns - 6);
  const labelBudget = items.length
    ? Math.max(10, Math.min(Math.floor(inner * 0.5), Math.max(...items.map((i) => i.label.length)) + 1))
    : 0;
  const descBudget = Math.max(8, inner - labelBudget - 2);
  const page = visibleRows;
  const totalPages = Math.max(1, Math.ceil(items.length / page));
  const currentPage = Math.min(totalPages, Math.floor(scroll / page) + 1);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color={accent}>
          {title}
        </Text>
        {subtitle ? (
          <Text color="gray" dimColor>
            {"  "}
            {truncate(subtitle, Math.max(8, inner - title.length - 20))}
          </Text>
        ) : null}
        {items.length > visibleRows ? (
          <Text color="gray" dimColor>
            {`  ${safeSel + 1}/${items.length} · pg ${currentPage}/${totalPages}`}
          </Text>
        ) : null}
      </Box>
      <Text> </Text>
      {items.length === 0 ? (
        <Text color="gray">{emptyText ?? "(empty)"}</Text>
      ) : (
        visible.map((item, vi) => {
          const i = scroll + vi;
          const sel = i === safeSel;
          const labelColor = item.disabled ? "gray" : sel ? accent : undefined;
          const labelText = truncate(item.label, labelBudget);
          const descText = item.description ? truncate(item.description, descBudget) : "";
          return (
            <Box key={item.key}>
              <Box width={2}>
                <Text color={sel ? accent : "gray"}>{sel ? "›" : " "}</Text>
              </Box>
              <Box width={labelBudget}>
                <Text color={labelColor} bold={sel}>
                  {labelText}
                </Text>
              </Box>
              <Text color="gray">{descText}</Text>
              {item.hint ? (
                <Text color="gray" dimColor>
                  {`  ${item.hint}`}
                </Text>
              ) : null}
            </Box>
          );
        })
      )}
      <Text> </Text>
      <Text color="gray" dimColor>
        {hintFooter ?? "↑↓ · PgUp/PgDn · Enter select · Esc close"}
      </Text>
    </Box>
  );
}
