/**
 * The guided walkthrough.
 *
 * A finished diagram explains itself to the person who drew it and to nobody
 * else. This is the part that walks everyone else through it: one beat at a
 * time, in order, with the rest of the diagram held back so the eye knows
 * where to look, and a sentence underneath saying what just happened.
 *
 * It drives the view rather than the model — dimming, panning, a caption —
 * so stepping through an incident never changes it.
 */

import type { Incident } from '../model/types';
import type { StoryBeat } from '../model/story';
import { buildStory } from '../model/story';
import { h } from './dom';

export interface WalkthroughHost {
  /** Where the caption bar is mounted. */
  container: HTMLElement;
  /** The element holding the rendered `<svg>`. */
  stage: HTMLElement;
  /** Centre the view on these artifacts. */
  focus(nodeIds: string[]): void;
  /** Called on entry and exit so the surrounding UI can get out of the way. */
  onChange?(active: boolean): void;
}

export class Walkthrough {
  private beats: StoryBeat[] = [];
  private at = -1;
  private bar: HTMLElement | null = null;

  constructor(private readonly host: WalkthroughHost) {}

  get active(): boolean {
    return this.at >= 0;
  }

  get position(): { index: number; total: number } {
    return { index: this.at, total: this.beats.length };
  }

  /** Which artifacts the current beat is about; empty when not walking. */
  get focusIds(): string[] {
    return this.active ? this.beats[this.at].focusIds : [];
  }

  start(incident: Incident): boolean {
    this.beats = buildStory(incident);
    if (!this.beats.length) return false;
    this.at = 0;
    // Tell the host first: it widens the canvas, and the focus that follows
    // has to measure against the room it will actually have.
    this.host.onChange?.(true);
    this.render();
    this.apply();
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.at = -1;
    this.beats = [];
    this.bar?.remove();
    this.bar = null;
    this.clearDimming();
    this.host.onChange?.(false);
  }

  step(delta: number): void {
    if (!this.active) return;
    const next = this.at + delta;
    if (next < 0 || next >= this.beats.length) return;
    this.at = next;
    this.render();
    this.apply();
  }

  goTo(index: number): void {
    if (!this.active || index < 0 || index >= this.beats.length) return;
    this.at = index;
    this.render();
    this.apply();
  }

  /** Re-apply after the diagram has been redrawn underneath us. */
  refresh(): void {
    if (this.active) this.apply();
  }

  // -------------------------------------------------------------------------

  private apply(): void {
    const beat = this.beats[this.at];
    const lit = new Set(beat.focusIds);

    const svg = this.host.stage.querySelector('svg');
    if (svg) {
      svg.classList.add('walking');
      svg.querySelectorAll<SVGElement>('[data-node-id]').forEach((g) => {
        g.classList.toggle('lit', lit.has(g.getAttribute('data-node-id') ?? ''));
      });
      svg.querySelectorAll<SVGElement>('[data-edge-id]').forEach((g) => {
        g.classList.toggle('lit', g.getAttribute('data-edge-id') === beat.edgeId);
      });
    }

    this.host.focus(beat.focusIds);
  }

  private clearDimming(): void {
    const svg = this.host.stage.querySelector('svg');
    if (!svg) return;
    svg.classList.remove('walking');
    svg.querySelectorAll<SVGElement>('.lit').forEach((g) => g.classList.remove('lit'));
  }

  private render(): void {
    const beat = this.beats[this.at];
    const total = this.beats.length;

    const bar = h(
      'div',
      { class: 'walk-bar' },
      h(
        'div',
        { class: 'walk-head' },
        h('span', { class: 'walk-count', text: `${this.at + 1} / ${total}` }),
        h('span', { class: 'walk-when', text: beat.t ? beat.t.replace('.000Z', 'Z') : 'no time recorded' }),
        beat.since ? h('span', { class: 'walk-since', text: beat.since }) : null,
        h('span', { class: 'walk-spacer' }),
        h('button', { class: 'btn btn-small', text: 'Leave the walkthrough', on: { click: () => this.stop() } }),
      ),
      h('p', { class: 'walk-sentence', text: beat.sentence }),
      beat.commentary ? h('p', { class: 'walk-note', text: beat.commentary }) : null,
      h(
        'div',
        { class: 'walk-controls' },
        h('button', {
          class: 'btn',
          text: '← Back',
          disabled: this.at === 0,
          on: { click: () => this.step(-1) },
        }),
        this.track(),
        h('button', {
          class: 'btn btn-primary',
          text: this.at === total - 1 ? 'Finish' : 'Next →',
          on: { click: () => (this.at === total - 1 ? this.stop() : this.step(1)) },
        }),
      ),
    );

    if (this.bar) this.bar.replaceWith(bar);
    else this.host.container.append(bar);
    this.bar = bar;
  }

  /** One tick per beat: a progress bar you can also click to jump. */
  private track(): HTMLElement {
    const track = h('div', { class: 'walk-track' });
    this.beats.forEach((beat, index) => {
      track.append(
        h('button', {
          class: index === this.at ? 'walk-tick walk-tick-now' : index < this.at ? 'walk-tick walk-tick-done' : 'walk-tick',
          title: `${index + 1}. ${beat.sentence}`,
          on: { click: () => this.goTo(index) },
        }),
      );
    });
    return track;
  }
}
