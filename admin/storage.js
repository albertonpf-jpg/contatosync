// ============================================
// STORAGE - Gerenciamento de Dados LocalStorage
// ============================================

const Storage = {
    // Keys
    CLIENTS_KEY: 'contatosync_clients',
    PAYMENTS_KEY: 'contatosync_payments',
    ACTIVITIES_KEY: 'contatosync_activities',
    AUTH_KEY: 'contatosync_auth',

    // ============ CLIENTS ============
    getClients() {
        const data = localStorage.getItem(this.CLIENTS_KEY);
        return data ? JSON.parse(data) : [];
    },

    saveClients(clients) {
        localStorage.setItem(this.CLIENTS_KEY, JSON.stringify(clients));
    },

    addClient(client) {
        const clients = this.getClients();
        client.id = this.generateId();
        client.createdAt = new Date().toISOString();
        clients.push(client);
        this.saveClients(clients);
        this.addActivity(`Novo cliente adicionado: ${client.name}`);
        return client;
    },

    updateClient(id, updates) {
        const clients = this.getClients();
        const index = clients.findIndex(c => c.id === id);
        if (index !== -1) {
            clients[index] = { ...clients[index], ...updates, updatedAt: new Date().toISOString() };
            this.saveClients(clients);
            this.addActivity(`Cliente atualizado: ${clients[index].name}`);
            return clients[index];
        }
        return null;
    },

    deleteClient(id) {
        const clients = this.getClients();
        const client = clients.find(c => c.id === id);
        if (client) {
            const filtered = clients.filter(c => c.id !== id);
            this.saveClients(filtered);
            this.addActivity(`Cliente removido: ${client.name}`);
            return true;
        }
        return false;
    },

    getClientById(id) {
        const clients = this.getClients();
        return clients.find(c => c.id === id);
    },

    // ============ PAYMENTS ============
    getPayments() {
        const data = localStorage.getItem(this.PAYMENTS_KEY);
        return data ? JSON.parse(data) : [];
    },

    savePayments(payments) {
        localStorage.setItem(this.PAYMENTS_KEY, JSON.stringify(payments));
    },

    addPayment(payment) {
        const payments = this.getPayments();
        payment.id = this.generateId();
        payment.createdAt = new Date().toISOString();
        payments.push(payment);
        this.savePayments(payments);
        this.addActivity(`Pagamento registrado: ${payment.clientName} - R$ ${payment.amount}`);
        return payment;
    },

    // ============ ACTIVITIES ============
    getActivities() {
        const data = localStorage.getItem(this.ACTIVITIES_KEY);
        return data ? JSON.parse(data) : [];
    },

    saveActivities(activities) {
        localStorage.setItem(this.ACTIVITIES_KEY, JSON.stringify(activities));
    },

    addActivity(message) {
        const activities = this.getActivities();
        activities.unshift({
            id: this.generateId(),
            message,
            timestamp: new Date().toISOString()
        });
        // Manter apenas últimas 100 atividades
        if (activities.length > 100) {
            activities.length = 100;
        }
        this.saveActivities(activities);
    },

    // ============ AUTH ============
    isAuthenticated() {
        const auth = localStorage.getItem(this.AUTH_KEY);
        if (!auth) return false;
        const { timestamp } = JSON.parse(auth);
        // Expirar após 24 horas
        const expirationTime = 24 * 60 * 60 * 1000;
        return (Date.now() - timestamp) < expirationTime;
    },

    login() {
        localStorage.setItem(this.AUTH_KEY, JSON.stringify({
            timestamp: Date.now()
        }));
    },

    logout() {
        localStorage.removeItem(this.AUTH_KEY);
    },

    // ============ UTILS ============
    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    // ============ DEMO DATA ============
    seedDemoData() {
        // Verifica se já tem dados
        if (this.getClients().length > 0) return;

        // Adicionar clientes de exemplo
        const demoClients = [
            {
                name: 'Loja ABC',
                email: 'contato@lojaabc.com.br',
                phone: '(11) 99999-1111',
                company: 'Loja de Roupas',
                plan: 'pro',
                status: 'ativo',
                railwayUrl: 'https://contatosync-lojaabc.up.railway.app',
                githubRepo: 'https://github.com/albertonpf-jpg/contatosync-lojaabc',
                installDate: '2026-03-15',
                setupFee: 397,
                notes: 'Cliente satisfeito, indicou 2 amigos'
            },
            {
                name: 'Imobiliária XYZ',
                email: 'contato@imobxyz.com.br',
                phone: '(11) 88888-2222',
                company: 'Imobiliária',
                plan: 'enterprise',
                status: 'ativo',
                railwayUrl: 'https://contatosync-imobxyz.up.railway.app',
                githubRepo: 'https://github.com/albertonpf-jpg/contatosync-imobxyz',
                installDate: '2026-03-20',
                setupFee: 697,
                notes: 'Empresa grande, possível expansão para 3 números'
            },
            {
                name: 'João Vendedor',
                email: 'joao@email.com',
                phone: '(11) 77777-3333',
                company: 'Vendedor Autônomo',
                plan: 'basico',
                status: 'teste',
                railwayUrl: 'https://contatosync-joao.up.railway.app',
                githubRepo: 'https://github.com/albertonpf-jpg/contatosync-joao',
                installDate: '2026-03-28',
                setupFee: 0,
                notes: 'Em período de teste, follow-up dia 12/04'
            }
        ];

        demoClients.forEach(client => this.addClient(client));

        // Adicionar alguns pagamentos
        const demoPayments = [
            {
                clientName: 'Loja ABC',
                type: 'Mensalidade',
                amount: 147,
                status: 'pago',
                date: '2026-03-15'
            },
            {
                clientName: 'Imobiliária XYZ',
                type: 'Setup',
                amount: 697,
                status: 'pago',
                date: '2026-03-20'
            },
            {
                clientName: 'Imobiliária XYZ',
                type: 'Mensalidade',
                amount: 297,
                status: 'pago',
                date: '2026-03-20'
            }
        ];

        demoPayments.forEach(payment => this.addPayment(payment));

        console.log('✅ Dados de exemplo adicionados!');
    },

    // ============ EXPORT/IMPORT ============
    exportData() {
        return {
            clients: this.getClients(),
            payments: this.getPayments(),
            activities: this.getActivities(),
            exportedAt: new Date().toISOString()
        };
    },

    importData(data) {
        if (data.clients) this.saveClients(data.clients);
        if (data.payments) this.savePayments(data.payments);
        if (data.activities) this.saveActivities(data.activities);
        this.addActivity('Dados importados');
    },

    clearAllData() {
        if (confirm('⚠️ ATENÇÃO: Isso vai apagar TODOS os dados. Tem certeza?')) {
            localStorage.removeItem(this.CLIENTS_KEY);
            localStorage.removeItem(this.PAYMENTS_KEY);
            localStorage.removeItem(this.ACTIVITIES_KEY);
            this.addActivity('Todos os dados foram limpos');
            return true;
        }
        return false;
    }
};

// Seed demo data on first load
if (Storage.getClients().length === 0) {
    Storage.seedDemoData();
}
