// @mojs/core ships no TypeScript types. Minimal typings for the parts we use.
// Options are loose on purpose: mo.js accepts many shapes ("from:to" objects, deltas, callbacks).
declare module "@mojs/core" {
  type MojsOptions = Record<string, unknown>;

  interface Tweenable<T> {
    play(shift?: number): T;
    playBackward(shift?: number): T;
    pause(): T;
    stop(progress?: number): T;
    replay(shift?: number): T;
    reset(): T;
    setProgress(progress: number): T;
    tune(options: MojsOptions): T;
    then(options: MojsOptions): T;
  }

  export class Shape implements Tweenable<Shape> {
    constructor(options?: MojsOptions);
    el: HTMLElement;
    play(shift?: number): Shape;
    playBackward(shift?: number): Shape;
    pause(): Shape;
    stop(progress?: number): Shape;
    replay(shift?: number): Shape;
    reset(): Shape;
    setProgress(progress: number): Shape;
    tune(options: MojsOptions): Shape;
    then(options: MojsOptions): Shape;
    generate(): Shape;
  }

  export class ShapeSwirl extends Shape {}

  export class Burst implements Tweenable<Burst> {
    constructor(options?: MojsOptions);
    el: HTMLElement;
    play(shift?: number): Burst;
    playBackward(shift?: number): Burst;
    pause(): Burst;
    stop(progress?: number): Burst;
    replay(shift?: number): Burst;
    reset(): Burst;
    setProgress(progress: number): Burst;
    tune(options: MojsOptions): Burst;
    then(options: MojsOptions): Burst;
    generate(): Burst;
  }

  export class Html implements Tweenable<Html> {
    constructor(options: MojsOptions & { el: HTMLElement | string });
    play(shift?: number): Html;
    playBackward(shift?: number): Html;
    pause(): Html;
    stop(progress?: number): Html;
    replay(shift?: number): Html;
    reset(): Html;
    setProgress(progress: number): Html;
    tune(options: MojsOptions): Html;
    then(options: MojsOptions): Html;
  }

  export class Tween {
    constructor(options?: MojsOptions);
    play(shift?: number): Tween;
    pause(): Tween;
    stop(progress?: number): Tween;
    replay(shift?: number): Tween;
    setProgress(progress: number): Tween;
  }

  export class Timeline {
    constructor(options?: MojsOptions);
    add(...items: unknown[]): Timeline;
    append(...items: unknown[]): Timeline;
    play(shift?: number): Timeline;
    playBackward(shift?: number): Timeline;
    pause(): Timeline;
    stop(progress?: number): Timeline;
    replay(shift?: number): Timeline;
    reset(): Timeline;
    setProgress(progress: number): Timeline;
  }

  export const easing: Record<string, unknown> & {
    path(path: string): (p: number) => number;
    bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number;
  };

  export function addShape(name: string, shape: unknown): void;

  const mojs: {
    Shape: typeof Shape;
    ShapeSwirl: typeof ShapeSwirl;
    Burst: typeof Burst;
    Html: typeof Html;
    Tween: typeof Tween;
    Timeline: typeof Timeline;
    easing: typeof easing;
    addShape: typeof addShape;
  };
  export default mojs;
}
