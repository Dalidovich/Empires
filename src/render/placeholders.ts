import type { AgeId, ArchitectureSet, BuildingDef, UnitDef } from '../data/types';
import type { CanvasSpriteSpec } from './canvasAtlas';
import {
  buildingWallHeight,
  isFlatBuilding,
  unitBodySize,
  unitShape,
} from './metrics';
import type { ResourceShape } from './metrics';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from './projection';

export type BuildingStage = 'c0' | 'c1' | 'c2' | 'full' | 'd1' | 'd2';

const LABEL_FONT = 'bold 9px sans-serif';
const LABEL_LINE_HEIGHT = 10;
const LABEL_MAX_CHARS = 9;
const LABEL_CHAR_WIDTH = 5.6;
const OUTLINE = '#000000';
const FILL = '#ffffff';
const SHADE_LEFT = '#c8c8c8';
const SHADE_RIGHT = '#9a9a9a';
const MARGIN = 3;

const STAGE_HEIGHT: Record<BuildingStage, number> = {
  c0: 0,
  c1: 0.4,
  c2: 0.75,
  full: 1,
  d1: 1,
  d2: 1,
};

const ROOF_HEIGHT: Record<ArchitectureSet, number> = {
  egyptian: 0,
  mesopotamian: 12,
  greek: 18,
  asian: 14,
};

export function labelLines(id: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of id.split('_')) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= LABEL_MAX_CHARS) {
      current = `${current}_${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines;
}

function labelSize(lines: readonly string[]): { width: number; height: number } {
  let longest = 0;
  for (const line of lines) {
    longest = Math.max(longest, line.length);
  }
  return {
    width: Math.ceil(longest * LABEL_CHAR_WIDTH) + 6,
    height: lines.length * LABEL_LINE_HEIGHT + 2,
  };
}

function paintLabel(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  centerX: number,
  top: number,
): void {
  const size = labelSize(lines);
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.beginPath();
  context.roundRect(centerX - size.width / 2, top, size.width, size.height, 3);
  context.fill();
  context.fillStyle = OUTLINE;
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.fillText(line, centerX, top + 2 + index * LABEL_LINE_HEIGHT, size.width - 2);
  });
}

function polygon(context: CanvasRenderingContext2D, points: readonly number[]): void {
  context.beginPath();
  context.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    context.lineTo(points[i], points[i + 1]);
  }
  context.closePath();
}

function fillStroke(context: CanvasRenderingContext2D, fill: string): void {
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = OUTLINE;
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.stroke();
}

function pseudoRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedOf(text: string): number {
  let seed = 7;
  for (let i = 0; i < text.length; i += 1) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }
  return seed;
}

export function unitPlaceholder(def: UnitDef, direction: number): CanvasSpriteSpec {
  const body = unitBodySize(def);
  const shape = unitShape(def);
  const lines = labelLines(def.id);
  const label = labelSize(lines);
  const width = Math.ceil(Math.max(body.width + MARGIN * 2, label.width + 2));
  const feetY = MARGIN + body.height;
  const height = Math.ceil(feetY + 2 + label.height + 1);
  const centerX = width / 2;
  return {
    width,
    height,
    anchorX: centerX,
    anchorY: feetY,
    paint(context) {
      const left = centerX - body.width / 2;
      const right = centerX + body.width / 2;
      const top = MARGIN;
      const middleY = top + body.height / 2;
      switch (shape) {
        case 'villager':
        case 'mounted':
        case 'animal':
          context.beginPath();
          context.ellipse(centerX, middleY, body.width / 2, body.height / 2, 0, 0, Math.PI * 2);
          fillStroke(context, FILL);
          break;
        case 'infantry':
          context.beginPath();
          context.roundRect(left, top, body.width, body.height, body.width / 2);
          fillStroke(context, FILL);
          break;
        case 'archer':
          polygon(context, [centerX, top, right, feetY, left, feetY]);
          fillStroke(context, FILL);
          break;
        case 'priest':
          polygon(context, [centerX, top, right, middleY, centerX, feetY, left, middleY]);
          fillStroke(context, FILL);
          break;
        case 'siege':
          context.beginPath();
          context.rect(left, top, body.width, body.height);
          fillStroke(context, FILL);
          break;
        case 'ship':
          polygon(context, [
            centerX,
            top,
            centerX + body.width * 0.3,
            top + body.height * 0.5,
            centerX,
            top + body.height * 0.5,
          ]);
          fillStroke(context, SHADE_LEFT);
          polygon(context, [
            left,
            top + body.height * 0.55,
            right,
            top + body.height * 0.55,
            right - body.width * 0.2,
            feetY,
            left + body.width * 0.2,
            feetY,
          ]);
          fillStroke(context, FILL);
          break;
      }
      const angle = direction * (Math.PI / 4);
      const eyeY = shape === 'ship' ? top + body.height * 0.78 : middleY;
      context.beginPath();
      context.arc(
        centerX + Math.cos(angle) * body.width * 0.3,
        eyeY + Math.sin(angle) * body.height * (shape === 'ship' ? 0.12 : 0.28),
        Math.max(1.5, body.width * 0.09),
        0,
        Math.PI * 2,
      );
      context.fillStyle = OUTLINE;
      context.fill();
      paintLabel(context, lines, centerX, feetY + 2);
    },
  };
}

export function resourcePlaceholder(type: string, shape: ResourceShape): CanvasSpriteSpec {
  const lines = labelLines(type);
  const label = labelSize(lines);
  const bodyWidth = shape === 'tree' ? 26 : 30;
  const bodyHeight = shape === 'tree' ? 44 : shape === 'fish' || shape === 'carcass' ? 12 : 20;
  const width = Math.ceil(Math.max(bodyWidth + MARGIN * 2, label.width + 2));
  const feetY = MARGIN + bodyHeight;
  const height = Math.ceil(feetY + 2 + label.height + 1);
  const centerX = width / 2;
  const flat = shape === 'fish' || shape === 'carcass';
  return {
    width,
    height,
    anchorX: centerX,
    anchorY: flat ? MARGIN + bodyHeight / 2 : feetY - 2,
    paint(context) {
      const left = centerX - bodyWidth / 2;
      const right = centerX + bodyWidth / 2;
      const top = MARGIN;
      switch (shape) {
        case 'tree':
          context.beginPath();
          context.rect(centerX - 2.5, feetY - 10, 5, 10);
          fillStroke(context, SHADE_RIGHT);
          polygon(context, [centerX, top + 12, right, feetY - 8, left, feetY - 8]);
          fillStroke(context, FILL);
          polygon(context, [centerX, top, right - 3, top + 22, left + 3, top + 22]);
          fillStroke(context, FILL);
          break;
        case 'bush':
          for (const [dx, dy, radius] of [
            [-8, -7, 7],
            [8, -7, 7],
            [0, -11, 8],
          ]) {
            context.beginPath();
            context.arc(centerX + dx, feetY + dy, radius, 0, Math.PI * 2);
            fillStroke(context, FILL);
          }
          break;
        case 'rock':
          polygon(context, [
            left,
            feetY,
            left + 4,
            top + 8,
            centerX - 3,
            top,
            centerX + 5,
            top + 5,
            right - 2,
            top + 3,
            right,
            feetY,
          ]);
          fillStroke(context, FILL);
          polygon(context, [centerX - 3, top, centerX, feetY - 6, centerX + 5, top + 5]);
          fillStroke(context, SHADE_LEFT);
          break;
        case 'fish':
          context.beginPath();
          context.ellipse(centerX, top + 6, bodyWidth / 2, 6, 0, 0, Math.PI * 2);
          fillStroke(context, FILL);
          context.beginPath();
          context.arc(centerX, top + 9, 7, Math.PI * 1.15, Math.PI * 1.85);
          context.stroke();
          break;
        case 'carcass':
          context.beginPath();
          context.ellipse(centerX, top + 6, bodyWidth / 2, 6, 0, 0, Math.PI * 2);
          fillStroke(context, FILL);
          for (let i = -1; i <= 1; i += 1) {
            context.beginPath();
            context.moveTo(centerX + i * 6, top + 2);
            context.lineTo(centerX + i * 6, top + 10);
            context.stroke();
          }
          break;
        case 'generic':
          polygon(context, [
            left + 6,
            top,
            right - 6,
            top,
            right,
            top + 10,
            right - 6,
            feetY,
            left + 6,
            feetY,
            left,
            top + 10,
          ]);
          fillStroke(context, FILL);
          break;
      }
      paintLabel(context, lines, centerX, feetY + 2);
    },
  };
}

export function ruinPlaceholder(type: string, size: number): CanvasSpriteSpec {
  const lines = labelLines(type);
  const label = labelSize(lines);
  const halfWidth = size * TILE_HALF_WIDTH * 0.9;
  const halfHeight = size * TILE_HALF_HEIGHT * 0.9;
  const columnHeight = 40;
  const width = Math.ceil(halfWidth * 2 + MARGIN * 2);
  const centerX = width / 2;
  const centerY = MARGIN + columnHeight + halfHeight;
  const height = Math.ceil(centerY + halfHeight + MARGIN + label.height);
  return {
    width,
    height,
    anchorX: centerX,
    anchorY: centerY,
    paint(context) {
      polygon(context, [
        centerX,
        centerY - halfHeight,
        centerX + halfWidth,
        centerY,
        centerX,
        centerY + halfHeight,
        centerX - halfWidth,
        centerY,
      ]);
      fillStroke(context, SHADE_RIGHT);
      const columns: [number, number, number][] = [
        [-halfWidth * 0.45, -2, columnHeight],
        [0, -halfHeight * 0.5, columnHeight * 0.55],
        [halfWidth * 0.45, 0, columnHeight * 0.8],
        [0, halfHeight * 0.45, columnHeight * 0.35],
      ];
      for (const [dx, dy, tall] of columns) {
        context.beginPath();
        context.rect(centerX + dx - 5, centerY + dy - tall, 10, tall);
        fillStroke(context, FILL);
      }
      paintLabel(context, lines, centerX, centerY + halfHeight + 1);
    },
  };
}

export function artifactPlaceholder(type: string): CanvasSpriteSpec {
  const lines = labelLines(type);
  const label = labelSize(lines);
  const radius = 11;
  const width = Math.ceil(Math.max(radius * 2 + MARGIN * 2, label.width + 2));
  const centerX = width / 2;
  const feetY = MARGIN + radius * 2;
  return {
    width,
    height: Math.ceil(feetY + 2 + label.height + 1),
    anchorX: centerX,
    anchorY: feetY,
    paint(context) {
      const centerY = MARGIN + radius;
      const points: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const reach = i % 2 === 0 ? radius : radius * 0.45;
        points.push(centerX + Math.cos(angle) * reach, centerY + Math.sin(angle) * reach);
      }
      polygon(context, points);
      fillStroke(context, FILL);
      paintLabel(context, lines, centerX, feetY + 2);
    },
  };
}

function paintBox(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  wall: number,
): void {
  if (wall > 0) {
    polygon(context, [
      centerX - halfWidth,
      centerY,
      centerX,
      centerY + halfHeight,
      centerX,
      centerY + halfHeight - wall,
      centerX - halfWidth,
      centerY - wall,
    ]);
    fillStroke(context, SHADE_LEFT);
    polygon(context, [
      centerX,
      centerY + halfHeight,
      centerX + halfWidth,
      centerY,
      centerX + halfWidth,
      centerY - wall,
      centerX,
      centerY + halfHeight - wall,
    ]);
    fillStroke(context, SHADE_RIGHT);
  }
  polygon(context, [
    centerX,
    centerY - halfHeight - wall,
    centerX + halfWidth,
    centerY - wall,
    centerX,
    centerY + halfHeight - wall,
    centerX - halfWidth,
    centerY - wall,
  ]);
  fillStroke(context, FILL);
}

function paintPyramid(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rise: number,
): void {
  const apexY = centerY - rise;
  polygon(context, [centerX - halfWidth, centerY, centerX, centerY + halfHeight, centerX, apexY]);
  fillStroke(context, '#e4e4e4');
  polygon(context, [centerX, centerY + halfHeight, centerX + halfWidth, centerY, centerX, apexY]);
  fillStroke(context, '#b4b4b4');
}

function paintDamage(
  context: CanvasRenderingContext2D,
  seed: number,
  count: number,
  centerX: number,
  centerY: number,
  halfWidth: number,
  wall: number,
  blotches: boolean,
): void {
  const random = pseudoRandom(seed);
  context.strokeStyle = OUTLINE;
  context.lineWidth = 1.5;
  for (let i = 0; i < count; i += 1) {
    let x = centerX + (random() * 2 - 1) * halfWidth * 0.7;
    let y = centerY - random() * Math.max(8, wall);
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 4; step += 1) {
      x += (random() * 2 - 1) * 7;
      y += 3 + random() * 6;
      context.lineTo(x, y);
    }
    context.stroke();
    if (blotches) {
      context.beginPath();
      context.arc(x, y - 10, 3 + random() * 4, 0, Math.PI * 2);
      context.fillStyle = 'rgba(0, 0, 0, 0.55)';
      context.fill();
    }
  }
}

export function buildingPlaceholder(
  def: BuildingDef,
  architecture: ArchitectureSet,
  age: AgeId,
  stage: BuildingStage,
): CanvasSpriteSpec {
  const footHalfWidth = def.size * TILE_HALF_WIDTH;
  const footHalfHeight = def.size * TILE_HALF_HEIGHT;
  const flat = isFlatBuilding(def);
  const tower = def.class.includes('tower');
  const wallClass = def.class.includes('wall');
  const inset = tower ? 0.6 : 0.92;
  const boxHalfWidth = footHalfWidth * inset;
  const boxHalfHeight = footHalfHeight * inset;
  const wall = flat ? 0 : buildingWallHeight(def, age) * STAGE_HEIGHT[stage];
  const finished = stage === 'full' || stage === 'd1' || stage === 'd2';
  const roof = finished && !flat && !wallClass ? ROOF_HEIGHT[architecture] : 0;
  const lines = labelLines(def.id);
  const label = labelSize(lines);
  const width = Math.ceil(Math.max(footHalfWidth * 2 * 1.12, label.width) + MARGIN * 2);
  const centerX = width / 2;
  const centerY = MARGIN + roof + wall + footHalfHeight;
  const height = Math.ceil(centerY + footHalfHeight + MARGIN);
  return {
    width,
    height,
    anchorX: centerX,
    anchorY: centerY,
    paint(context) {
      if (stage === 'c0' || flat) {
        polygon(context, [
          centerX,
          centerY - boxHalfHeight,
          centerX + boxHalfWidth,
          centerY,
          centerX,
          centerY + boxHalfHeight,
          centerX - boxHalfWidth,
          centerY,
        ]);
        if (stage === 'c0') {
          context.setLineDash([5, 4]);
          fillStroke(context, 'rgba(255, 255, 255, 0.4)');
          context.setLineDash([]);
        } else {
          fillStroke(context, stage === 'full' ? '#e6e6e6' : 'rgba(255, 255, 255, 0.6)');
          context.lineWidth = 1;
          for (let i = 1; i < 6; i += 1) {
            const t = i / 6;
            context.beginPath();
            context.moveTo(centerX - boxHalfWidth * t, centerY - boxHalfHeight * (1 - t));
            context.lineTo(centerX + boxHalfWidth * (1 - t), centerY + boxHalfHeight * t);
            context.stroke();
          }
        }
      } else {
        paintBox(context, centerX, centerY, boxHalfWidth, boxHalfHeight, wall);
        const roofY = centerY - wall;
        if (roof > 0 && architecture === 'mesopotamian') {
          paintBox(context, centerX, roofY, boxHalfWidth * 0.6, boxHalfHeight * 0.6, roof);
        } else if (roof > 0) {
          const overhang = architecture === 'asian' ? 1.12 : 1;
          paintPyramid(
            context,
            centerX,
            roofY,
            boxHalfWidth * overhang,
            boxHalfHeight * overhang,
            roof + boxHalfHeight,
          );
        }
        if (stage === 'd1' || stage === 'd2') {
          paintDamage(
            context,
            seedOf(def.id),
            stage === 'd1' ? 3 : 7,
            centerX,
            centerY,
            boxHalfWidth,
            wall,
            stage === 'd2',
          );
        }
      }
      paintLabel(context, lines, centerX, centerY - wall / 2 - label.height / 2);
    },
  };
}

export function ringPlaceholder(): CanvasSpriteSpec {
  return {
    width: 68,
    height: 36,
    anchorX: 34,
    anchorY: 18,
    paint(context) {
      context.beginPath();
      context.ellipse(34, 18, 32, 16, 0, 0, Math.PI * 2);
      context.strokeStyle = FILL;
      context.lineWidth = 2;
      context.stroke();
    },
  };
}

export function diamondPlaceholder(): CanvasSpriteSpec {
  return {
    width: 132,
    height: 68,
    anchorX: 66,
    anchorY: 34,
    paint(context) {
      polygon(context, [66, 2, 130, 34, 66, 66, 2, 34]);
      context.strokeStyle = FILL;
      context.lineWidth = 2;
      context.stroke();
    },
  };
}

export function arrowPlaceholder(): CanvasSpriteSpec {
  return {
    width: 16,
    height: 5,
    anchorX: 8,
    anchorY: 2.5,
    paint(context) {
      polygon(context, [0, 2.5, 11, 1.5, 16, 2.5, 11, 3.5]);
      context.fillStyle = FILL;
      context.fill();
    },
  };
}

export function stonePlaceholder(): CanvasSpriteSpec {
  return {
    width: 10,
    height: 10,
    anchorX: 5,
    anchorY: 5,
    paint(context) {
      context.beginPath();
      context.arc(5, 5, 4, 0, Math.PI * 2);
      context.fillStyle = FILL;
      context.fill();
    },
  };
}

export function genericPlaceholder(type: string): CanvasSpriteSpec {
  return resourcePlaceholder(type, 'generic');
}
