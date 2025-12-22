class MartingaleCalculator {
  /**
   * @param {number} profitTargetPercent Целевой процент прибыли в долях (например, 0.005 для 0.5%)
   */
  constructor(obj = {}) {
    this.obj = obj;
  }

  /**
   * Рассчитывает среднюю цену входа (Break-even price) на основе всех предыдущих покупок.
   * @returns {number} Средневзвешенная цена входа.
   */
  calculateAverageEntryPrice() {
    const filteredNameArray = this.obj.name.filter((item) => item.status === 'FILLED');

    let totalInvested = 0;
    let totalQuantity = 0;

    for (const order of filteredNameArray) {
      totalInvested += order.price * order.quantity; // Сумма затрат = Цена * Количество
      totalQuantity += order.quantity; // Общее количество актива
    }

    if (totalQuantity === 0) {
      return 0;
    }

    return totalInvested / totalQuantity;
  }

  /**
   * Рассчитывает целевую цену продажи на основе средней цены входа и заданной прибыли.
   *
   * @param {number} averageEntryPrice Средняя цена входа.
   * @returns {number} Целевая цена продажи (цена выхода).
   */
  calculateTargetSalePrice(averageEntryPrice) {
    if (averageEntryPrice === 0) {
      return 0;
    }
    // Целевая цена = Средняя цена * (1 + Процент прибыли)
    return averageEntryPrice * (1 + this.obj.param['field-profit']);
  }
}

// =============================================================================
// ПРИМЕР ИСПОЛЬЗОВАНИЯ
// =============================================================================

// 1. Инициализируем калькулятор с целью прибыли 0.5%
// const calculator = new MartingaleCalculator(0.005);

// 2. Пример данных: история двух покупок
// const executedOrdersHistory = [
//   { price: 500.00, quantity: 0.02 },       // Первая покупка $10
//   { price: 480.00, quantity: 0.04166667 }  // Вторая покупка $20
// ];

// // 3. Рассчитываем среднюю цену входа
// const avgPrice = calculator.calculateAverageEntryPrice(executedOrdersHistory);
// console.log(`Средняя цена входа: ${avgPrice.toFixed(3)}`); // Вывод: 486.670

// // 4. Рассчитываем целевую цену продажи
// const targetPrice = calculator.calculateTargetSalePrice(avgPrice);
// console.log(`Целевая цена продажи (с 0.5% прибыли): ${targetPrice.toFixed(3)}`); // Вывод: 489.103

module.exports = { MartingaleCalculator };
