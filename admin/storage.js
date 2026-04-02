// ============================================
// STORAGE - Gerenciamento de Dados com Supabase
// ============================================

const Storage = {
    // ============ CLIENTS ============
    async getClients() {
        const { data, error } = await supabaseClient
            .from('clients')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erro ao buscar clientes:', error);
            return [];
        }
        return data || [];
    },

    async addClient(client) {
        const newClient = {
            ...client,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('clients')
            .insert([newClient])
            .select()
            .single();

        if (error) {
            console.error('Erro ao adicionar cliente:', error);
            throw error;
        }

        await this.addActivity(`Novo cliente adicionado: ${client.name}`);
        return data;
    },

    async updateClient(id, updates) {
        const { data, error } = await supabaseClient
            .from('clients')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Erro ao atualizar cliente:', error);
            throw error;
        }

        await this.addActivity(`Cliente atualizado: ${data.name}`);
        return data;
    },

    async deleteClient(id) {
        // Buscar cliente antes de deletar para pegar o nome
        const { data: client } = await supabaseClient
            .from('clients')
            .select('name')
            .eq('id', id)
            .single();

        const { error } = await supabaseClient
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Erro ao deletar cliente:', error);
            return false;
        }

        if (client) {
            await this.addActivity(`Cliente removido: ${client.name}`);
        }
        return true;
    },

    async getClientById(id) {
        const { data, error } = await supabaseClient
            .from('clients')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('Erro ao buscar cliente:', error);
            return null;
        }
        return data;
    },

    // ============ PAYMENTS ============
    async getPayments() {
        const { data, error } = await supabaseClient
            .from('payments')
            .select('*')
            .order('date', { ascending: false });

        if (error) {
            console.error('Erro ao buscar pagamentos:', error);
            return [];
        }
        return data || [];
    },

    async addPayment(payment) {
        const newPayment = {
            ...payment,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from('payments')
            .insert([newPayment])
            .select()
            .single();

        if (error) {
            console.error('Erro ao adicionar pagamento:', error);
            throw error;
        }

        await this.addActivity(`Pagamento registrado: ${payment.client_name} - R$ ${payment.amount}`);
        return data;
    },

    async updatePayment(id, updates) {
        const { data, error } = await supabaseClient
            .from('payments')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Erro ao atualizar pagamento:', error);
            throw error;
        }
        return data;
    },

    async deletePayment(id) {
        const { error } = await supabaseClient
            .from('payments')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Erro ao deletar pagamento:', error);
            return false;
        }
        return true;
    },

    // ============ ACTIVITIES ============
    async getActivities(limit = 100) {
        const { data, error } = await supabaseClient
            .from('activities')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Erro ao buscar atividades:', error);
            return [];
        }
        return data || [];
    },

    async addActivity(message) {
        const { error } = await supabaseClient
            .from('activities')
            .insert([{
                message,
                timestamp: new Date().toISOString()
            }]);

        if (error) {
            console.error('Erro ao adicionar atividade:', error);
        }
    },

    // ============ AUTH ============
    isAuthenticated() {
        const auth = localStorage.getItem('contatosync_auth');
        if (!auth) return false;
        const { timestamp } = JSON.parse(auth);
        // Expirar após 24 horas
        const expirationTime = 24 * 60 * 60 * 1000;
        return (Date.now() - timestamp) < expirationTime;
    },

    login() {
        localStorage.setItem('contatosync_auth', JSON.stringify({
            timestamp: Date.now()
        }));
    },

    logout() {
        localStorage.removeItem('contatosync_auth');
    },

    // ============ EXPORT/IMPORT ============
    async exportData() {
        const clients = await this.getClients();
        const payments = await this.getPayments();
        const activities = await this.getActivities();

        return {
            clients,
            payments,
            activities,
            exportedAt: new Date().toISOString()
        };
    },

    async importData(data) {
        if (data.clients && data.clients.length > 0) {
            for (const client of data.clients) {
                await this.addClient(client);
            }
        }
        if (data.payments && data.payments.length > 0) {
            for (const payment of data.payments) {
                await this.addPayment(payment);
            }
        }
        await this.addActivity('Dados importados');
    },

    async clearAllData() {
        if (confirm('⚠️ ATENÇÃO: Isso vai apagar TODOS os dados do Supabase. Tem certeza?')) {
            // Deletar todas as atividades
            await supabaseClient.from('activities').delete().neq('id', '');
            // Deletar todos os pagamentos
            await supabaseClient.from('payments').delete().neq('id', '');
            // Deletar todos os clientes
            await supabaseClient.from('clients').delete().neq('id', '');

            await this.addActivity('Todos os dados foram limpos');
            return true;
        }
        return false;
    }
};
