export class Binance {
    constructor(baseURL = 'https://api.binance.com') {
        this.baseURL = baseURL;
    }
    
    // Получить серверное время
    async getServerTime() {
        const res = await fetch(`${this.baseURL}/api/v3/time`);
        const data = await res.json();
        return new Date(data.serverTime).toLocaleString();
    }
    
    // Получить цену символа (например BTCUSDT)
    async getPrice(symbol = 'BTCUSDT') {
        const res = await fetch(`${this.baseURL}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
        const data = await res.json();
        return {
            symbol: data.symbol,
            price: parseFloat(data.price)
        };
    }

    // Получить список всех торговых пар и цен
    async getAllPrices() {
        const res = await fetch(`${this.baseURL}/api/v3/ticker/price`);
        const data = await res.json();
        return data;
    }

    /**
     * Exchange Information
     * {@link https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information}
     */
    async exchangeInfo(options = {}) {
        const str = `${this.baseURL}/api/v3/exchangeInfo?symbols=${JSON.stringify(options.symbols)}`;
        const res = await fetch(str);
        const data = await res.json();
        return data;
    }

    async tickerPrice(options = {}) {
        // symbols = options.symbols.map(symbol => symbol.toUpperCase())
        const str = `${this.baseURL}/api/v3/ticker/price?symbols=${JSON.stringify(options.symbols)}`;
        const res = await fetch(str);
        const data = await res.json();

        if (Array.isArray(data)) {
            // return object
            return data.length === 1 ? data[0] : data;
        }
        
        // return array
        return data;
    }

    /**
     * Account information
     * {@link https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints#account-information-user_data}
     */
    async account(options = {}) {
        const str = `${this.baseURL}/api/v3/account`;
        const res = await fetch(str);
        const data = await res.json();
        return data;
    }
}