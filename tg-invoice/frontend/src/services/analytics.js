/**
 * Product analytics (PostHog) — activation funnels such as
 * signup → first invoice → first payment.
 *
 * No npm dependency: with VITE_POSTHOG_KEY set we inject PostHog's official
 * snippet, which installs a buffering stub first so events fired while the SDK
 * is still downloading are kept rather than dropped. Without a key (the dev
 * default) every function is a silent no-op, so call sites need no guard.
 */

const key = import.meta.env.VITE_POSTHOG_KEY || '';
const host = (import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

let started = false;

/**
 * PostHog's official loader snippet (trimmed to what we need).
 * `window.posthog` becomes a stub whose methods buffer until `array.js`
 * finishes loading and replays them, so capture/identify are always safe.
 */
const SNIPPET = `!function(t,e){var o,p,n,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.document.createElement("script"),p.type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(o=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,o));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag isFeatureEnabled reloadFeatureFlags on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys captureException alias set_config startSessionRecording stopSessionRecording identify setPersonProperties group reset resetGroups get_distinct_id get_session_id opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);u._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;

/** Load PostHog. Safe to call more than once; no-ops without a key. */
export function initAnalytics() {
  if (started || !key || typeof document === 'undefined') return;
  started = true;

  const script = document.createElement('script');
  script.innerHTML = SNIPPET;
  document.head.appendChild(script);

  window.posthog.init(key, {
    api_host: `https://${host}`,
    capture_pageview: false, // SPAs have no reload per route — App.jsx owns pageviews
    persistence: 'localStorage',
    person_profiles: 'identified_only',
  });
}

/** Record an event. Never throws. */
export function capture(event, props = {}) {
  if (!key || typeof window === 'undefined' || !window.posthog?.capture) return;
  try {
    window.posthog.capture(event, props);
  } catch {
    /* analytics must never break the app */
  }
}

/** Attach identity + traits to every subsequent event. */
export function identify({ id, email, name } = {}) {
  if (!key || !id || typeof window === 'undefined' || !window.posthog?.identify) return;
  try {
    window.posthog.identify(id, email ? { email, name: name || undefined } : name ? { name } : {});
  } catch {
    /* ignore */
  }
}

/** Point events at the active business (company-level grouping). */
export function setAnalyticsGroup(tenantId) {
  if (!key || !tenantId || typeof window === 'undefined' || !window.posthog?.group) return;
  try {
    window.posthog.group('company', tenantId);
  } catch {
    /* ignore */
  }
}

/** Drop identity on logout so the next user is not conflated with the last. */
export function resetAnalytics() {
  if (!key || typeof window === 'undefined' || !window.posthog?.reset) return;
  try {
    window.posthog.reset();
  } catch {
    /* ignore */
  }
}

export const isAnalyticsEnabled = Boolean(key);

export default { initAnalytics, capture, identify, setAnalyticsGroup, resetAnalytics, isAnalyticsEnabled };
