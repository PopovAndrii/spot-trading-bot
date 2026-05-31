// Синхронизирует состояние кнопок +/- SpinBox с текущим значением input.
// Нужно после программной установки value (el.value = ...): пакет пересчитывает
// состояние кнопок только на своих событиях, поэтому "минус" иначе остаётся
// заблокированным с момента инициализации (value=min из шаблона).
export function syncSpinBoxButtons(root = document) {
  root.querySelectorAll('.UIsp').forEach((sp) => {
    if (sp.hasAttribute('data-disabled')) return; // полностью отключённые не трогаем

    const input = sp.querySelector('.UIsp__input');
    const btns = sp.querySelectorAll('.UIsp__btn');
    if (!input || btns.length < 2) return;

    const [minusBtn, plusBtn] = btns;
    const value = Number(input.value);
    const min = readNumber(sp.getAttribute('data-min'));
    const max = readNumber(sp.getAttribute('data-max'));

    setDisabled(minusBtn, !Number.isNaN(value) && value <= min);
    setDisabled(plusBtn, max !== 0 && !Number.isNaN(value) && value >= max);
  });
}

function readNumber(v) {
  return v === null || v.trim() === '' || isNaN(Number(v)) ? 0 : Number(v);
}

function setDisabled(btn, state) {
  btn.classList.toggle('disabled', state);
  btn.disabled = state;
}
