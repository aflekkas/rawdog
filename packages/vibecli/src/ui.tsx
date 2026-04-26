import React from "react";
import { Box, Text } from "ink";

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((p) => p.toString(16).padStart(2, "0")).join("")}`;
}

export function hslToRgb(hue: number, saturation: number, lightness: number) {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hh = hue / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));

  let r = 0;
  let g = 0;
  let b = 0;

  if (hh >= 0 && hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = lightness - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rainbowColorAt(ratio: number, phase: number): string {
  const hue = (phase * 14 + ratio * 220) % 360;
  const { r, g, b } = hslToRgb(hue, 0.95, 0.62);
  return rgbToHex(r, g, b);
}

// Pink gradient across characters, slowly drifting with phase.
// Hue stays in the violet-magenta → rose band (295..355).
export function pinkGradientAt(ratio: number, phase: number = 0): string {
  const hue = 295 + ((phase * 2 + ratio * 30) % 60);
  const { r, g, b } = hslToRgb(hue, 0.9, 0.68);
  return rgbToHex(r, g, b);
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function GradientText({ text, phase = 0 }: { text: string; phase?: number }) {
  const chars = text.split("");
  return (
    <Box>
      {chars.map((char, index) => {
        const ratio = chars.length <= 1 ? 0 : index / (chars.length - 1);
        return (
          <Text key={`${char}-${index}`} color={pinkGradientAt(ratio, phase)}>
            {char}
          </Text>
        );
      })}
    </Box>
  );
}
