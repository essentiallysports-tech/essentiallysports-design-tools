#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /data-image-asset-tabs[\s\S]*?data-image-tool="move"[\s\S]*?>Background<[\s\S]*?data-image-tool="foreground-1"[\s\S]*?>Entity 1<[\s\S]*?data-image-tool="foreground-2"[\s\S]*?>Entity 2</.test(html),
  'Image Controls must expose named Background, Entity 1, and Entity 2 asset tabs.',
);
assert(
  !/data-image-tool="zoom"/.test(html) && !/data-image-tool-panel="zoom"/.test(html),
  'Image Controls must not retain a separate Zoom mode.',
);
assert(
  /data-image-tool-panel="move"[\s\S]*?id="rail-offset-x"[\s\S]*?id="rail-offset-y"[\s\S]*?id="rail-photo-scale"/.test(html),
  'Background must keep horizontal, vertical, and zoom controls in one panel.',
);
assert(
  /data-image-empty="background"[\s\S]*?data-image-slot-upload="move"[\s\S]*?data-image-content="background"/.test(html),
  'Background must have distinct upload-only and populated contextual states.',
);
assert(
  /availableTools\.length <= 1/.test(html) && /\.image-asset-tabs\.is-single\s*\{[\s\S]*?display:\s*none;/.test(html),
  'Single-image templates must hide the asset selector.',
);
assert(
  /function resetImageTool\(tool\)[\s\S]*?state\.entityOffsetX2 = 0;[\s\S]*?state\.entityOffsetX = 0;[\s\S]*?state\.photoOffsetX = 0;/.test(html),
  'Reset must target the selected image slot without flattening all slot state.',
);
assert(
  /selectImageTool\(isDoubleEntityImagePost\(\) \? 'foreground-1' : 'move', true\)/.test(html)
    && /selectImageTool\('foreground-1', true\)/.test(html)
    && /selectImageTool\('foreground-2', true\)/.test(html),
  'Newly uploaded or replaced images must become the selected asset.',
);
assert(
  /body:is\(\[data-instagram-post-type="listicle-type-1"\], \[data-instagram-post-type="listicle-type-2"\]\) \.image-tool-rail\s*\{[\s\S]*?display:\s*none/.test(html),
  'Listicle Types 1 and 2 must continue hiding Image Controls.',
);
assert(
  !/Image Controls <span class="studio-dock-kicker">Canvas tools<\/span>/.test(html),
  'The inspector must not repeat the Image Controls heading or Canvas tools label.',
);
assert(
  /data-image-tool="move"[^>]*aria-controls="image-tool-background-panel"/.test(html)
    && /id="image-tool-background-panel" role="tabpanel"/.test(html),
  'Asset tabs must identify their contextual panels for assistive technology.',
);
assert(
  /\.image-context-empty\s*\{[\s\S]*?flex-wrap:\s*wrap;/.test(html),
  'The empty upload state must wrap cleanly in narrow inspectors.',
);
assert(
  !/querySelector\('\[data-background-remove\]'\)/.test(html),
  'Legacy background-remove toolbar wiring must not remain after the contextual editor migration.',
);
assert(
  /data-canvas-image-edit-frame[\s\S]*?data-canvas-image-edit-toolbar[\s\S]*?data-canvas-image-zoom="out"[\s\S]*?data-canvas-image-zoom="in"/.test(html),
  'The canvas must expose a selected-image frame and compact zoom toolbar.',
);
assert(
  /function isCanvasImageEditAvailable\(\)[\s\S]*?studioInspector !== 'image'/.test(html)
    && /function setupCanvasImageEditing\(\)/.test(html),
  'Direct canvas image editing must only activate in the Image Controls inspector.',
);
assert(
  /registerImageEditBounds\(ctx, img/.test(html)
    && /getSelectedImageEditBounds\(\)/.test(html)
    && /pointInBounds\(point, bounds\)/.test(html),
  'Direct manipulation must use the selected image bounds rather than the entire canvas.',
);
assert(
  /function drawScalableCoverImage[\s\S]*?registerImageEditBounds\(ctx, img, \{ x: drawX, y: drawY, w: drawW, h: drawH \}\)/.test(html)
    && /function drawImageCoverRect[\s\S]*?registerImageEditBounds\(ctx, img, \{ x: drawX, y: drawY, w: drawW, h: drawH \}\)/.test(html),
  'Selection borders must use the transformed bitmap geometry, not the fixed crop container.',
);
assert(
  /data-canvas-image-scale-handle="top-left"/.test(html)
    && /scaleSession\.startScale \* \(distance \/ scaleSession\.startDistance\)/.test(html),
  'The selected image must expose proportional corner-handle scaling.',
);
assert(
  /selectionCenter/.test(html)
    && /toolbar\.style\.left =/.test(html)
    && /toolbar\.style\.top =/.test(html)
    && /selectionBottom \+ 10/.test(html),
  'The floating image controls must stay anchored to the selected image as it moves and scales.',
);
assert(
  /requestAnimationFrame\(applyPendingInteractiveTransform\)/.test(html)
    && /queueInteractiveTransform\(activeImageTool/.test(html)
    && /flushInteractiveTransform\(\)/.test(html)
    && /interactive:\s*true/.test(html)
    && /immediate:\s*true/.test(html),
  'Pointer-driven image transforms must be animation-frame batched for smooth direct manipulation.',
);
assert(
  /const activationDistance = 3/.test(html)
    && /distance < activationDistance/.test(html)
    && /movement < activationDistance/.test(html),
  'Image movement and scaling must wait for deliberate pointer movement instead of reacting to small clicks or hover jitter.',
);
assert(
  /isPrimaryPointerPressed\(event\)/.test(html)
    && /lostpointercapture/.test(html)
    && /window\.addEventListener\('blur', stopAllPointerSessions\)/.test(html),
  'Image edit sessions must stop when the primary pointer is released, capture is lost, or the browser loses focus.',
);
assert(
  !/canvas\.addEventListener\('wheel'/.test(html)
    && /data-canvas-image-done/.test(html)
    && /event\.key === 'Escape'/.test(html),
  'Crop mode must preserve normal page scrolling and provide Done and Escape exits.',
);
assert(
  /if \(isCanvasImageEditMode\(\)\) return;/.test(html),
  'Image edit mode must prevent the text drag handler from competing for the canvas.',
);
assert(
  /class="image-context-precision"[\s\S]*?type="number" id="rail-offset-x"[\s\S]*?type="number" id="rail-offset-y"[\s\S]*?type="number" id="rail-photo-scale"/.test(html),
  'Large image sliders must be replaced by compact precise X, Y, and Zoom fields.',
);
assert(
  /window\.ESSyncCanvasImageEditMode\?\.\(\);/.test(html),
  'Switching inspector tabs must synchronize direct canvas image editing.',
);

console.log('Contextual image controls tests passed.');
