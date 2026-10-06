import { Rectangle, Texture } from 'pixi.js';

export interface SpriteFrame {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}

export interface CanvasSpriteSpec {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  paint(context: CanvasRenderingContext2D): void;
}

interface AtlasPage {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: Texture;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  dirty: boolean;
}

const PAGE_SIZE = 1024;
const PADDING = 2;

export class CanvasAtlas {
  private readonly pages: AtlasPage[] = [];
  private readonly frames: Texture[] = [];

  add(spec: CanvasSpriteSpec): SpriteFrame {
    const width = Math.min(PAGE_SIZE - PADDING * 2, Math.ceil(spec.width));
    const height = Math.min(PAGE_SIZE - PADDING * 2, Math.ceil(spec.height));
    const page = this.pageFor(width, height);
    const x = page.cursorX;
    const y = page.cursorY;
    page.cursorX += width + PADDING;
    page.rowHeight = Math.max(page.rowHeight, height);
    page.dirty = true;

    const context = page.context;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.translate(x, y);
    spec.paint(context);
    context.restore();

    const texture = new Texture({
      source: page.texture.source,
      frame: new Rectangle(x, y, width, height),
    });
    this.frames.push(texture);
    return {
      texture,
      anchorX: spec.anchorX / width,
      anchorY: spec.anchorY / height,
    };
  }

  flush(): void {
    for (const page of this.pages) {
      if (page.dirty) {
        page.texture.source.update();
        page.dirty = false;
      }
    }
  }

  destroy(): void {
    for (const frame of this.frames) {
      frame.destroy(false);
    }
    for (const page of this.pages) {
      page.texture.destroy(true);
    }
    this.frames.length = 0;
    this.pages.length = 0;
  }

  private pageFor(width: number, height: number): AtlasPage {
    const last = this.pages[this.pages.length - 1];
    if (last) {
      if (last.cursorX + width + PADDING > PAGE_SIZE) {
        last.cursorX = PADDING;
        last.cursorY += last.rowHeight + PADDING;
        last.rowHeight = 0;
      }
      if (last.cursorY + height + PADDING <= PAGE_SIZE) {
        return last;
      }
    }
    return this.createPage();
  }

  private createPage(): AtlasPage {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_SIZE;
    canvas.height = PAGE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is not available');
    }
    const texture = Texture.from(canvas, true);
    const page: AtlasPage = {
      canvas,
      context,
      texture,
      cursorX: PADDING,
      cursorY: PADDING,
      rowHeight: 0,
      dirty: false,
    };
    this.pages.push(page);
    return page;
  }
}
