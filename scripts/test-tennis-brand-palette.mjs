#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

const variations = ['Regular Clay', 'Regular Grass', 'US Open', 'Wimbledon'];
for (const variation of variations) {
  assert(
    new RegExp(`sport:\\s*'Tennis',[\\s\\S]*?variation:\\s*'${variation}'`).test(html),
    `The shared sports palette must expose Tennis / ${variation}.`,
  );
}

assert(
  !/sport:\s*'Tennis',[\s\S]*?team:\s*/.test(html.slice(html.indexOf("BRAND_KIT.push("), html.indexOf('function createDesignerState'))),
  'Tennis must use variations rather than teams.',
);

assert(/sport === 'Tennis' \? 'Variations' : 'Team'/.test(html), 'The Tennis selector must be labeled Variations.');
assert(/t\.variation \|\| t\.team/.test(html), 'Palette lookup must support Tennis variations without changing other sports.');

const combinations = [
  ['#A4472A', '#FFFFFF'],
  ['#F3E7D3', '#5A2416'],
  ['#5A2416', '#FFFFFF'],
  ['#FFFFFF', '#7B321F'],
  ['#1F5D3A', '#FFFFFF'],
  ['#E8F4E4', '#16432B'],
  ['#16432B', '#F4F0D8'],
  ['#FFFFFF', '#1F5D3A'],
  ['#003B5C', '#F7E017'],
  ['#F7E017', '#003B5C'],
  ['#003B5C', '#FFFFFF'],
  ['#FFFFFF', '#003B5C'],
  ['#5A2A82', '#FFFFFF'],
  ['#006633', '#FFFFFF'],
  ['#FFFFFF', '#5A2A82'],
  ['#E8DFF2', '#3E1C59'],
];

for (const [background, foreground] of combinations) {
  const pattern = new RegExp(`background:\\s*'${background}',\\s*foreground:\\s*'${foreground}'`);
  assert(pattern.test(html), `Missing Tennis color pairing ${background} / ${foreground}.`);
  assert(contrast(background, foreground) >= 4.5, `Tennis color pairing ${background} / ${foreground} is below WCAG AA contrast.`);
}

console.log('Tennis brand palette tests passed.');
