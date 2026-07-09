export async function runKeyboardAudit(page, options = {}) {
  const maxTabs = options.maxTabs || 30;
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+L' : 'Control+L').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => document.body?.focus());

  const path = [];
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    path.push(await activeElementSnapshot(page, index + 1));
  }

  await page.keyboard.press('Escape').catch(() => {});

  const uniqueSelectors = new Set(path.map((item) => item.selector).filter(Boolean));
  const focusVisibleFailures = path.filter((item) => item.selector && !item.focusIndicatorLikelyVisible);

  return {
    maxTabs,
    path,
    uniqueFocusedCount: uniqueSelectors.size,
    focusVisibleFailures,
    possibleTrap: path.length >= 8 && uniqueSelectors.size <= 1,
  };
}

async function activeElementSnapshot(page, step) {
  return page.evaluate((stepNumber) => {
    const element = document.activeElement;
    if (!element || element === document.body) {
      return {
        step: stepNumber,
        selector: 'body',
        tag: 'body',
        name: '',
        rect: null,
        focusIndicatorLikelyVisible: true,
      };
    }

    const selectorFor = (target) => {
      if (target.id) {
        return `#${CSS.escape(target.id)}`;
      }

      const parts = [];
      let current = target;
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

    const textOf = (target) => (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const outlineWidth = Number.parseFloat(style.outlineWidth || '0');
    const hasOutline = outlineWidth >= 2 && style.outlineStyle !== 'none' && style.outlineColor !== 'transparent';
    const hasShadow = style.boxShadow && style.boxShadow !== 'none';
    const hasOffset = Number.parseFloat(style.outlineOffset || '0') !== 0;

    return {
      step: stepNumber,
      selector: selectorFor(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      name: (
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        textOf(element) ||
        element.getAttribute('placeholder') ||
        ''
      ).slice(0, 160),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        pageX: Math.round(rect.x + window.scrollX),
        pageY: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      focusStyle: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow,
      },
      focusIndicatorLikelyVisible: hasOutline || hasShadow || hasOffset,
    };
  }, step);
}
