export class SpotWS{
    constructor(){
        this.ws;

        window.addEventListener('load', () => {
            this.connectWebSocket();
        });

        this.btnStart();
    }
    
    connectWebSocket() {
        this.ws = new WebSocket(`ws://${location.host}`);
        
        this.ws.onopen = () => {
            console.log('✅ WS onopen()');
            // Можно отправить сообщение при подключении
            // ws.send(JSON.stringify({ type: 'start' })); // не нужно )
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('📩 Message received:', data);
            // Обновление UI или выполнение логики
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'data') {
                    // console.log(JSON.stringify(message.data, null, 2));
                    console.log('ok');
                }
            } catch (err) { console.error('❌ Parsing error:', err); }
        };
        
        this.ws.onclose = (event) => {
            console.warn('❌ Connect. onclose() Code:', event.code);
            // reconnect
            setTimeout(connectWebSocket, 2000);
        };
        
        this.ws.onerror = (err) => { console.error('⚠️ WebSocket error:', err); };
    }
    
    btnStart() {
        const toggleBtn = document.getElementById('toggleBtn');
        let isRunning = false;

        toggleBtn.addEventListener('click', () => {
            if (!isRunning) {
                this.ws.send(JSON.stringify({ 
                    type: 'start', 
                    symbol: currency  
                }));
                
                toggleBtn.innerHTML = 'Stop <i class="bi bi-stop-fill"></i>';
                isRunning = true;
            } else {
                this.ws.send(JSON.stringify({ 
                    type: 'stop' 
                }));
                toggleBtn.innerHTML = 'Start <i class="bi bi-caret-right-fill"></i>';
                isRunning = false;
            }
        });
    }
}