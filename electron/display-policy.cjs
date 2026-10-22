'use strict';

/** Local QA never falls back from ASUS. Public builds ask the person explicitly. */
async function chooseDisplay({ displays, explicitId, distribution, testMode, preferredId, choose }) {
  if (explicitId) {
    const selected = displays.find((display) => String(display.id) === String(explicitId));
    if (!selected) throw new Error('指定的显示器当前不可用，请检查显示器连接。');
    return selected;
  }
  if (distribution !== 'open-source' || testMode) {
    const selected = displays.find((display) => /ASUS|华硕|PA279/i.test(display.label || ''));
    if (!selected) throw new Error('无法确认 ASUS 测试屏幕。未打开其他屏幕上的窗口。');
    return selected;
  }
  const remembered = displays.find((display) => String(display.id) === String(preferredId));
  if (remembered) return remembered;
  const selectedId = await choose(
    displays.map((display, index) => ({
      id: display.id,
      label: `${display.label || `显示器 ${index + 1}`} · ${display.size.width} × ${display.size.height}`,
    })),
  );
  const selected = displays.find((display) => String(display.id) === String(selectedId));
  if (!selected) throw new Error('尚未选择显示器，应用未启动。');
  return selected;
}

module.exports = { chooseDisplay };
