export async function collectDomSignals(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const textOf = (element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const selectorFor = (element) => {
      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        let part = current.tagName.toLowerCase();
        if (current.classList.length) {
          part += `.${Array.from(current.classList).slice(0, 2).map((name) => CSS.escape(name)).join('.')}`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };

    const accessibleNameHint = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText || '')
          .join(' ')
          .trim();
      }

      if (element.labels?.length) {
        return Array.from(element.labels).map((label) => textOf(label)).join(' ').trim();
      }

      return (
        element.getAttribute('aria-label') ||
        element.getAttribute('alt') ||
        element.getAttribute('title') ||
        textOf(element) ||
        element.getAttribute('placeholder') ||
        ''
      ).trim();
    };

    const rectFor = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        pageX: Math.round(rect.x + window.scrollX),
        pageY: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const focusableSelector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      'summary',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
    ].join(',');

    const clickables = Array.from(document.querySelectorAll(focusableSelector))
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        role: element.getAttribute('role') || '',
        type: element.getAttribute('type') || '',
        text: textOf(element).slice(0, 120),
        name: accessibleNameHint(element).slice(0, 160),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        tabIndex: element.tabIndex,
        rect: rectFor(element),
      }));

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(visible)
      .map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: textOf(element).slice(0, 160),
        selector: selectorFor(element),
        rect: rectFor(element),
      }));

    const images = Array.from(document.querySelectorAll('img,svg[role="img"],canvas'))
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        alt: element.getAttribute('alt') || '',
        role: element.getAttribute('role') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        ariaHidden: element.getAttribute('aria-hidden') || '',
        text: textOf(element).slice(0, 160),
        rect: rectFor(element),
      }));

    const forms = Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        type: element.getAttribute('type') || '',
        name: accessibleNameHint(element),
        required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
        invalid: Boolean(element.matches(':invalid') || element.getAttribute('aria-invalid') === 'true'),
        rect: rectFor(element),
      }));

    const statusCandidates = Array.from(document.querySelectorAll('[role="status"],[role="alert"],[aria-live],.toast,.snackbar,.message,.notification,.loading,.error,.empty'))
      .filter(visible)
      .map((element) => ({
        selector: selectorFor(element),
        role: element.getAttribute('role') || '',
        ariaLive: element.getAttribute('aria-live') || '',
        text: textOf(element).slice(0, 180),
        className: element.className || '',
        rect: rectFor(element),
      }));

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog,.modal,.drawer'))
      .filter(visible)
      .map((element) => ({
        selector: selectorFor(element),
        role: element.getAttribute('role') || '',
        ariaModal: element.getAttribute('aria-modal') || '',
        name: accessibleNameHint(element),
        text: textOf(element).slice(0, 220),
        rect: rectFor(element),
      }));

    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible)
      .map((element) => ({
        selector: selectorFor(element),
        href: element.getAttribute('href') || '',
        text: textOf(element).slice(0, 160),
        name: accessibleNameHint(element).slice(0, 160),
        rect: rectFor(element),
      }));

    return {
      title: document.title,
      lang: document.documentElement.getAttribute('lang') || '',
      headings,
      images,
      forms,
      clickables,
      statusCandidates,
      dialogs,
      links,
    };
  });
}
