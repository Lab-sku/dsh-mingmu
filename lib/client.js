/**
 * 明眸 VisionBridge —— 浏览器半边：设置卡片 + 模型页 stub 隐藏。
 *
 * 1. 在「设置」页注册一张「明眸 VisionBridge（视觉桥）」卡片
 *    （settings.section slot），字段读写主机 settings 命名空间 `vision-bridge`，
 *    保存即写 settings.yaml、实时生效（applies: live）。
 * 2. 隐藏「设置 → 模型」页那张由可配置提供方注册产生的 stub 卡片
 *    （该注册是让命名空间可写的必要机制，rc.6 没有 hidden 字段，
 *    只能像 zh_pro 一样用 DOM 观察器精确隐藏，中文界面生效）。
 *
 * 经典脚本（非 ESM），遵循客户端模块系统约定：
 * window.__ModuleLoader__.load({ id, factory })，工厂返回的 exports
 * 提供 inject 与 apply。
 */

window.__ModuleLoader__.load({
  id: 'dsh-vision-bridge',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    var NS = 'vision-bridge'
    var CARD_ID = 'dsh-vision-bridge-settings'
    var I18N_NS = 'dsh-vision-bridge-settings'
    var PROVIDER_NAME = '明眸 VisionBridge（视觉桥）'

    var I18N_ZH = {
      nav: '明眸 VisionBridge（视觉桥）',
      desc: '给纯文本模型装外挂眼睛：图片自动送视觉模型识别，识别文字喂回主模型。',
      enabled: '启用',
      enabledDesc: '总开关',
      providers: '生效的主模型 provider',
      providersDesc: '逗号分隔；留空 = 全部',
      strategy: '策略',
      strategyDesc: 'cascade 级联 / race 并发赛跑',
      visionBaseURL: '视觉 API 端点',
      visionBaseURLDesc: '视觉模型供应商地址',
      visionModel: '首选识别模型',
      visionModelDesc: '默认 Qwen3-VL-8B',
      visionModelUpgrade: '升级/赛跑模型',
      visionModelUpgradeDesc: '默认 Qwen3-VL-32B',
      apiKeyEnv: 'API Key 引用',
      apiKeyEnvDesc: '环境变量名（key 留在凭据文件）',
      failureMode: '失败策略',
      failureModeDesc: 'annotate 标注 / error 严格报错',
      maxTokens: '识别最大 token',
      timeoutMs: '识别超时（毫秒）',
      prompt: '识别提示词',
      promptDesc: '完整转录文字/布局/数据，只输出识别结果',
      save: '保存',
      saved: '已保存 ✓',
      pending: '设置加载中…',
    }
    var I18N_EN = {
      nav: 'VisionBridge',
      desc: 'External eyes for text-only models: images are described by a vision model and fed back as text.',
      enabled: 'Enabled',
      enabledDesc: 'Master switch',
      providers: 'Main-model providers',
      providersDesc: 'Comma separated; empty = all',
      strategy: 'Strategy',
      strategyDesc: 'cascade / race',
      visionBaseURL: 'Vision API endpoint',
      visionBaseURLDesc: 'Vision provider base URL',
      visionModel: 'Primary vision model',
      visionModelDesc: 'Default Qwen3-VL-8B',
      visionModelUpgrade: 'Upgrade/race model',
      visionModelUpgradeDesc: 'Default Qwen3-VL-32B',
      apiKeyEnv: 'API key env ref',
      apiKeyEnvDesc: 'Env var name (key stays in credentials file)',
      failureMode: 'Failure mode',
      failureModeDesc: 'annotate / error',
      maxTokens: 'Max tokens',
      timeoutMs: 'Timeout (ms)',
      prompt: 'Vision prompt',
      promptDesc: 'Transcribe text/layout/data; output only the result',
      save: 'Save',
      saved: 'Saved ✓',
      pending: 'Loading settings…',
    }

    var boundScope = null
    var scopeListeners = []
    var scopeStore = {
      getSnapshot: function () {
        return boundScope === null ? { status: 'pending' } : boundScope.getSnapshot()
      },
      subscribe: function (listener) {
        scopeListeners.push(listener)
        var unsub = null
        if (boundScope !== null && typeof boundScope.subscribe === 'function') {
          unsub = boundScope.subscribe(listener)
        }
        return function () {
          var at = scopeListeners.indexOf(listener)
          if (at !== -1) scopeListeners.splice(at, 1)
          if (unsub !== null) unsub()
        }
      },
    }

    var rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-divider, rgba(0,0,0,0.08))' }
    var labelStyle = { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary, inherit)' }
    var descStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #666)' }
    var inputStyle = { width: '260px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #ccc)', background: 'var(--dsw-alias-bg-field, #fff)', color: 'inherit', fontSize: 13 }

    function fieldRow(key, label, desc, control) {
      return React.createElement('div', { key: key, style: rowStyle },
        React.createElement('div', { style: { minWidth: 0, flex: '1' } },
          React.createElement('div', { style: labelStyle }, label),
          React.createElement('div', { style: descStyle }, desc)),
        React.createElement('div', { style: { flex: 'none' } }, control))
    }

    var VisionBridgeSection = function (props) {
      var t = props.t
      var snapshot = React.useSyncExternalStore(scopeStore.subscribe, scopeStore.getSnapshot)
      var ready = snapshot !== null && snapshot.status === 'ready' && snapshot.value !== null && typeof snapshot.value === 'object'
      var value = ready ? snapshot.value : {}
      var draftState = React.useState(null)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var savedState = React.useState(false)
      var saved = savedState[0]
      var setSaved = savedState[1]

      var current = draft !== null ? draft : value
      var update = function (key, next) {
        setSaved(false)
        setDraft(Object.assign({}, current, { [key]: next }))
      }
      var save = function () {
        if (boundScope === null || typeof boundScope.set !== 'function') return
        var patch = Object.assign({}, value, current)
        Object.keys(patch).forEach(function (key) {
          try { void boundScope.set(key, patch[key]) } catch (e) { /* 单字段失败不影响其余 */ }
        })
        setSaved(true)
        setTimeout(function () { setSaved(false) }, 2000)
      }

      var text = function (key) {
        return React.createElement('input', {
          style: inputStyle,
          value: typeof current[key] === 'string' ? current[key] : '',
          onChange: function (e) { update(key, e.target.value) },
        })
      }
      var number = function (key) {
        return React.createElement('input', {
          type: 'number',
          style: inputStyle,
          value: typeof current[key] === 'number' ? current[key] : 0,
          onChange: function (e) { update(key, Number(e.target.value)) },
        })
      }
      var toggle = function (key) {
        return React.createElement('input', {
          type: 'checkbox',
          checked: current[key] === true,
          onChange: function (e) { update(key, e.target.checked) },
        })
      }
      var select = function (key, options) {
        return React.createElement('select', {
          style: inputStyle,
          value: current[key] || options[0],
          onChange: function (e) { update(key, e.target.value) },
        }, options.map(function (opt) {
          return React.createElement('option', { key: opt, value: opt }, opt)
        }))
      }

      if (!ready) {
        return React.createElement('div', { style: { padding: '16px 0', color: 'var(--dsw-alias-label-tertiary, #666)' } }, t('pending'))
      }

      return React.createElement('div', { style: { padding: '4px 0' } },
        React.createElement('p', { style: descStyle }, t('desc')),
        fieldRow('enabled', t('enabled'), t('enabledDesc'), toggle('enabled')),
        fieldRow('providers', t('providers'), t('providersDesc'), text('providers')),
        fieldRow('strategy', t('strategy'), t('strategyDesc'), select('strategy', ['cascade', 'race'])),
        fieldRow('visionBaseURL', t('visionBaseURL'), t('visionBaseURLDesc'), text('visionBaseURL')),
        fieldRow('visionModel', t('visionModel'), t('visionModelDesc'), text('visionModel')),
        fieldRow('visionModelUpgrade', t('visionModelUpgrade'), t('visionModelUpgradeDesc'), text('visionModelUpgrade')),
        fieldRow('apiKeyEnv', t('apiKeyEnv'), t('apiKeyEnvDesc'), text('apiKeyEnv')),
        fieldRow('failureMode', t('failureMode'), t('failureModeDesc'), select('failureMode', ['annotate', 'error'])),
        fieldRow('maxTokens', t('maxTokens'), '', number('maxTokens')),
        fieldRow('timeoutMs', t('timeoutMs'), '', number('timeoutMs')),
        fieldRow('prompt', t('prompt'), t('promptDesc'),
          React.createElement('textarea', {
            style: Object.assign({}, inputStyle, { width: '320px', minHeight: '80px', resize: 'vertical' }),
            value: typeof current.prompt === 'string' ? current.prompt : '',
            onChange: function (e) { update('prompt', e.target.value) },
          })),
        React.createElement('div', { style: { padding: '12px 0' } },
          React.createElement('button', {
            style: { padding: '6px 16px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #ccc)', background: 'var(--dsw-alias-bg-action, #eee)', cursor: 'pointer' },
            onClick: save,
          }, saved ? t('saved') : t('save'))))
    }

    function apply(ctx) {
      if (ctx.slots !== undefined && typeof ctx.slots.inject === 'function') {
        if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') {
          ctx.effect(function () {
            ctx.locale.register(I18N_NS, { zh: I18N_ZH, en: I18N_EN })
          }, 'dsh-vision-bridge: settings dictionaries')
        }
        var t = (ctx.locale !== undefined && typeof ctx.locale.bind === 'function')
          ? ctx.locale.bind(I18N_NS)
          : function (key) { return I18N_ZH[key] || key }
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: CARD_ID,
            order: 51,
            label: function () { return t('nav') },
            locale: I18N_NS,
          }, function () {
            return React.createElement(VisionBridgeSection, { t: t })
          })
        })
      }

      if (typeof ctx.inject === 'function') {
        ctx.inject(['settingsScope'], function (settingsCtx) {
          var binder = settingsCtx === null ? null : settingsCtx.get('settingsScope')
          if (binder === undefined || binder === null || typeof binder.bind !== 'function') return
          var scope = binder.bind({ namespace: NS })
          boundScope = scope
          if (typeof scope.subscribe === 'function') {
            var unsub = scope.subscribe(function () {
              for (var i = 0; i < scopeListeners.length; i += 1) scopeListeners[i]()
            })
            settingsCtx.effect(function () {
              return function () {
                if (boundScope === scope) boundScope = null
                if (typeof unsub === 'function') unsub()
              }
            }, 'dsh-vision-bridge: settings scope')
          }
        })
      }

      // 隐藏「设置 → 模型」页里由可配置提供方注册产生的 stub 卡片（中文界面）。
      ctx.effect(function () {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
        var hideKey = 'data-dsh-vision-bridge-hide-provider'
        var hide = function (textNode) {
          if (textNode.data !== PROVIDER_NAME) return
          var el = textNode.parentElement
          for (var depth = 0; el !== null && depth < 6; depth += 1) {
            if (el.tagName === 'LI') {
              if (el.getAttribute(hideKey) === null) el.setAttribute(hideKey, '')
              el.style.setProperty('display', 'none', 'important')
              return
            }
            if (el.tagName === 'OPTION') {
              if (el.getAttribute(hideKey) === null) el.setAttribute(hideKey, '')
              el.hidden = true
              return
            }
            el = el.parentElement
          }
        }
        var run = function (root) {
          if (root.nodeType === 3) {
            hide(root)
            return
          }
          if (root.nodeType !== 1) return
          var child = root.firstChild
          while (child !== null) {
            run(child)
            child = child.nextSibling
          }
        }
        var observer = new MutationObserver(function () {
          observer.disconnect()
          try {
            if (document.body !== null) run(document.body)
          } finally {
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
          }
        })
        var start = function () {
          if (document.body !== null) run(document.body)
          observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', start, { once: true })
        } else {
          start()
        }
        return function () {
          observer.disconnect()
        }
      }, 'dsh-vision-bridge: hide models stub')
    }

    exports.inject = ['locale', 'slots']
    exports.apply = apply
    return module.exports
  },
})
