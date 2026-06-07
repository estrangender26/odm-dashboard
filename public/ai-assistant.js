(function (global) {
  'use strict';

  function redirectToUnifiedAssistant() {
    if (global.location && global.location.pathname.endsWith('.html')) {
      var target = global.location.pathname.replace(/\.html$/, '');
      global.location.assign(target);
    }
  }

  global.AIAssistant = {
    openPanel: redirectToUnifiedAssistant,
    closePanel: function () {},
    clearChat: function () {},
    ask: redirectToUnifiedAssistant,
    handleKeyDown: function (event) {
      if (event && event.key === 'Enter') redirectToUnifiedAssistant();
    },
    renderSuggestedChips: function () {},
  };
})(window);
