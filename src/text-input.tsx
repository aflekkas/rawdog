import React from "react";
import { Box, Text, useInput } from "ink";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
  focus?: boolean;
};

// Find the start of the previous word from index i (exclusive).
// Word = run of non-whitespace, preceded by whitespace.
function wordStart(s: string, i: number): number {
  let j = i;
  while (j > 0 && /\s/.test(s[j - 1]!)) j--;
  while (j > 0 && !/\s/.test(s[j - 1]!)) j--;
  return j;
}

function wordEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && /\s/.test(s[j]!)) j++;
  while (j < s.length && !/\s/.test(s[j]!)) j++;
  return j;
}

export function TextInput({ value, onChange, onSubmit, placeholder, focus = true }: Props) {
  const [cursor, setCursor] = React.useState(value.length);

  // Keep cursor in bounds if value shrinks from outside.
  React.useEffect(() => {
    if (cursor > value.length) setCursor(value.length);
  }, [value, cursor]);

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(value);
        return;
      }

      // --- deletion ---
      // backspace: Option+Backspace or Ctrl+W → word back; Ctrl+U → to line start
      if (key.backspace || key.delete) {
        if (key.meta || (key.ctrl && input === "w")) {
          const start = wordStart(value, cursor);
          onChange(value.slice(0, start) + value.slice(cursor));
          setCursor(start);
          return;
        }
        if (cursor === 0) return;
        onChange(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
        return;
      }

      if (key.ctrl && input === "w") {
        const start = wordStart(value, cursor);
        onChange(value.slice(0, start) + value.slice(cursor));
        setCursor(start);
        return;
      }
      if (key.ctrl && input === "u") {
        // delete to line start (Cmd+Backspace equivalent)
        onChange(value.slice(cursor));
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "k") {
        onChange(value.slice(0, cursor));
        return;
      }

      // --- cursor movement ---
      if (key.leftArrow) {
        if (key.meta) setCursor(wordStart(value, cursor));
        else if (cursor > 0) setCursor(cursor - 1);
        return;
      }
      if (key.rightArrow) {
        if (key.meta) setCursor(wordEnd(value, cursor));
        else if (cursor < value.length) setCursor(cursor + 1);
        return;
      }
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        setCursor(value.length);
        return;
      }

      // Ignore other control chars and arrow-ups/downs
      if (key.upArrow || key.downArrow || key.tab || key.escape) return;
      if (key.ctrl || key.meta) return;

      // --- insertion ---
      if (input && input.length > 0) {
        onChange(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
      }
    },
    { isActive: focus },
  );

  // Render with an inverted cursor.
  if (!value) {
    return (
      <Box>
        <Text inverse> </Text>
        {placeholder ? <Text color="gray">{placeholder}</Text> : null}
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  );
}
