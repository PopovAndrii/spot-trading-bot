export class CancelAllOrders{
    constructor(){
      const orders = document.getElementById('cancel-all-orders');
      orders.addEventListener('click', () => {
        this.cancel(currency)
      });
      
    }
  
    // @TODO move to invokeApi
    async cancel(currency) {
      try {
        const res = await fetch(`/spotbot/cancel/allorders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: currency })
      });
    
        const data = await res.json();
        console.log('response cancel():', data);
  
      } catch (err) {
        console.error('❌ cancelAllOrders():', err);
        return null;
      }
    }
  
  };

  