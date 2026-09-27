/* Static presentation interactions. No API calls, wallet access or transactions. */
const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
if (menu && navigation) {
  document.documentElement.classList.add('js');
  menu.hidden = false;
  const closeMenu = () => {
    menu.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  };
  menu.addEventListener('click', () => {
    const expanded = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(expanded));
    navigation.classList.toggle('is-open', expanded);
  });
  navigation.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      closeMenu(); menu.focus();
    }
  });
  window.matchMedia('(min-width: 821px)').addEventListener('change', closeMenu);
}
const money = value => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2
}).format(value);
const copy = {
  fresh: 'Fresh price, sufficient depth. The model permits new borrowing within its limit.',
  stale: 'The price is stale. New borrowing is disabled; the existing executable sale value remains $99,000.',
  thin: 'Routable depth is below the model floor. New borrowing is disabled; existing collateral keeps a positive executable mark.'
};
const buttons = document.querySelectorAll('[data-scenario]');
if (window.RWA_DEMO) {
  const show = key => {
    const scenario = window.RWA_DEMO.scenarios[key];
    if (!scenario) return;
    const { input, result } = scenario;
    for (const [id, value] of Object.entries({
      'demo-oracle': result.oracleValue, 'demo-executable': result.executableValue,
      'demo-ecv': result.ecv, 'demo-borrow': result.outputs.max_borrow
    })) document.getElementById(id).textContent = money(value);
    const status = document.getElementById('demo-status');
    status.textContent = result.outputs.borrow_disabled ? 'BORROW DISABLED' : 'BORROW ENABLED';
    status.className = result.outputs.borrow_disabled ? 'warning' : 'accent';
    document.getElementById('demo-explanation').textContent = copy[key];
    document.getElementById('demo-inputs').textContent = `Price age: ${input.priceAgeSec}s · Routable depth: ${money(input.routableUsd)} · Price impact: ${input.impactPct}% · Regular session`;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === key)));
  };
  buttons.forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => show(button.dataset.scenario));
  });
  show('fresh');
}
