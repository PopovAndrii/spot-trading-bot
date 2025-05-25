export class Calculator {
    constructor(constructorData, strategy = 'long') {
        const params = this.parseNumbers(constructorData);

        // BTCUSDT
        const defaultData = {
            'field-currency': 0.10794235, //368.5,
            'field-deposit': 560, // 1.074 430$
            'field-orderSize': 125, // 0.028
            'field-profit': 0.10,
            'field-fibonachiStep': 0.20, // fibonachi
            'field-martingail': 49,
            'field-indent': 0.10,
            'field-trackPrice': 0.15, // в построении не учавствует
            'field-staticStep': 0.0,
            'field-requestFrequency': 500,// в построении не учавствует
            'field-stepSize': null, 
            'field-tickSize': null,
        }
        this.data = Object.assign(defaultData, params); 
        // this.data = defaultData;
        // console.log(this.data)

        return this.factory(strategy);
    }

    factory = (strategy) => {
        return (strategy == 'long') ? this.long() : this.short();
    }

    parseNumbers = (obj) => {
        return Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [key, isNaN(value) ? value : Number(value)])
        );
    }

    long = () => {
        let mainObj = [];
        
        const balanceTotal = this.data['field-deposit'];

        // процент отступа ордера
        let overlapRange = 0.0;

        let buyPrice = 0.0;
        let buy = 0.0;
        let sellCurrency = 0.0;
        let coverage = 0.0;
    
        // всего накоплено для продажи
        let totalSell = 0.0;
    
        // всего израсходовано баланса
        let spentTotal = 0.0;

        // потраченные средства
        let spentFunds  = this.data['field-orderSize'] * this.data['field-currency'];

        for (let i = 0; this.data['field-deposit'] > spentFunds; ++i) {

            if (i == 0) {
                overlapRange = this.data['field-indent'];
                coverage = this.data['field-staticStep'] + this.data['field-fibonachiStep'];
            } else {
                overlapRange += coverage;
                coverage += this.data['field-fibonachiStep'];

                spentFunds = spentFunds * ((100 + this.data['field-martingail']) / 100);
            }

            // курс покупки
            buyPrice = (this.data['field-currency'] * ((100 - overlapRange) / 100));
    
            // всего нужно купить валют.
            if (this.data['field-stepSize'] == 1) { //округление вверх Math.ceil()
                buy = Math.round(spentFunds / buyPrice);
            } else {
                buy = (spentFunds / buyPrice);
            }

            // после округления необходимо пересчитать потраченное
            spentFunds = buy * buyPrice;

            spentTotal += spentFunds;
            
            // всего накоплено для продажи
            totalSell = (totalSell + buy);
            
            // sell Число * (100 + Процент) / 100
            sellCurrency = ((spentTotal / totalSell) * (100 +  this.data['field-profit'] + 0.2) / 100);

            this.data['field-deposit'] = this.data['field-deposit'] - spentFunds;

            if (this.data['field-deposit'] < 0) break;

            const modelDataRow = {
                "overlapRange": overlapRange.toFixed(2) ,
                // купить по курсу
                "buyCurrency": buyPrice.toFixed(this.data['field-tickSize']) ,
                // купить колличество
                "buy": buy.toFixed(this.data['field-stepSize']) ,
                // продать колличество
                "totalSell": totalSell.toFixed(this.data['field-stepSize']),
                // продать по курсу
                "sellCurrency": sellCurrency.toFixed(this.data['field-tickSize']) ,
                "didBuy": spentFunds.toFixed(this.data['field-stepSize']) , // information data
                "calcBalance": this.data['field-deposit'].toFixed(this.data['field-stepSize']) , // information data
                // "balanceTotal": balanceTotal - this.data['field-deposit'] , // information data
            };

            mainObj.push(modelDataRow);
            // m_vec.append(modelDataRow);
        }

        // console.log('List:',mainObj);
        return mainObj;
    }

    short = () => {
        const mainObj = [];
        
        const balanceTotal = this.data['field-deposit'];

        // процент отступа ордера this.data['field-indent']
        let overlapRange = this.data['field-indent'];
        
        let sellCurrency = 0.0;

        let buyCurrency = 0.0;
        
        let coverage = this.data['field-staticStep'] + this.data['field-fibonachiStep'];

        // всего накоплено для покупки
        let sellTotal = 0.0;

        // всего израсходовано баланса
        let spentTotal = 0.0;

        // сттавка SELL
        let sell  = this.data['field-orderSize'];

        for (let i = 0; this.data['field-deposit'] > this.data['field-orderSize']; ++i) {

            if (i != 0) {
                overlapRange += coverage;
                coverage += this.data['field-fibonachiStep'];

                sell = sell * ((100 + this.data['field-martingail']) / 100);
            }

            this.data['field-deposit'] -= sell;
            
            if (this.data['field-deposit'] < 0) break;
            
            spentTotal += sell;

            sellCurrency = this.data['field-currency'] * ((100 + overlapRange) / 100);
            
            sellTotal += (sell / sellCurrency);
            
            // sell Число * (100 + Процент) / 100
            buyCurrency = ((spentTotal / sellTotal) * (100 - (this.data['field-profit'] + 0.2)) / 100);
            
            const modelDataRow = {
                "overlapRange": overlapRange.toFixed(2) ,
                // купить по курсу
                "buyCurrency": buyCurrency.toFixed(this.data['field-tickSize']) ,
                // купить колличество
                "buy": (balanceTotal - this.data['field-deposit']).toFixed(this.data['field-stepSize']) ,
                // "buy": balanceTotal + "-" + this.data['field-deposit'] ,
                // продать колличество
                "totalSell": sell.toFixed(this.data['field-stepSize']),
                // продать по курсу
                "sellCurrency": sellCurrency.toFixed(this.data['field-tickSize']) ,
                "didBuy": sell.toFixed(this.data['field-stepSize']) , // information data
                "calcBalance": this.data['field-deposit'].toFixed(this.data['field-stepSize']) , // information data
                // "balanceTotal": balanceTotal - this.data["balance"] , // information data
            };
            
            mainObj.push(modelDataRow);
            // m_vec.append(modelDataRow);
        }

        // console.log(mainObj);
        return mainObj;
    }

}