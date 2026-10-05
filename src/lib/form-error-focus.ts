export function focusFormError(fieldId: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(fieldId);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = target.matches('input, textarea, button, [tabindex]')
        ? target
        : target.querySelector<HTMLElement>('input, textarea, button, [tabindex]');
      input?.focus({ preventScroll: true });
    });
  });
}
