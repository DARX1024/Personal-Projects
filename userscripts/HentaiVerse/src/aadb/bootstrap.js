// ==================== 初始化函数 ====================
async function init() {
  // 仅在主站保存URL，避免e-hentai覆盖返回目标
  if ((/^(\w+\.)?hentaiverse\.org$/).test(window.location.host)) {
    AAD.Core.Storage.setValue('url', window.location.origin);
  }


  AAD.Runtime.init();

  if (AAD.Runtime.pageType === 'ehentai') {
    AAD.Logic.PageHandler.handleEhentaiPage();
    return;
  }

  const domCheck = AAD.Utils.DOM.gE('#navbar,#riddlecounter,#textlog');
  if (!domCheck) {
    return;
  }

  try {
    AAD.UI.Theme.init();
  } catch (error) {
    console.error('[AAD初始化] 主题初始化失败:', error);
    throw error;
  }

  AAD.UI.Panel.init();

  const storedOption = AAD.Core.Storage.getValue('option');
  if (!storedOption) {
    AAD.UI.Panel.toggle();
    return;
  }

  AAD.UI.ExternalControls.init(storedOption);

  AAD.Core.State.init();

  const config = storedOption;
  AAD.Core.State.set('option', config);

  switch (AAD.Runtime.pageType) {
    case 'riddle':
      AAD.Logic.PageHandler.handleRiddlePage();
      break;
    case 'battle':
      AAD.Logic.PageHandler.handleBattlePage();
      break;
    case 'main':
    case 'isekai':
      await AAD.Logic.PageHandler.handleWorldPage();
      break;
    default:
      console.warn('[AAD] 未知页面类型:', AAD.Runtime.pageType);
  }
}
// ==================== Runtime驱动的主入口 ====================
init();
