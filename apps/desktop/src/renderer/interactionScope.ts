/** Keep pointer, keyboard and accessibility-tree access inside the active surface. */
export class InteractionScope {
  constructor(private readonly root: HTMLElement, private readonly closedPanels: () => HTMLElement[]) {}

  sync(surface: HTMLElement | null): void {
    const closed = this.closedPanels();
    for (const child of Array.from(this.root.children)) {
      if (!(child instanceof HTMLElement)) continue;
      child.inert = surface ? child !== surface && !child.contains(surface) : closed.includes(child);
    }
    document.documentElement.classList.toggle("interaction-locked", Boolean(surface));
    document.body.dataset.interaction = surface?.id ?? "";
  }

  focusFirst(...targets: Array<HTMLElement | null | undefined>): void {
    for (const target of targets) {
      if (target?.isConnected && !target.matches(":disabled") && !target.closest("[inert]") &&
          target.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
        target.focus();
        if (document.activeElement === target) return;
      }
    }
  }
}
