// ============================================
// CONTATOSYNC ADMIN - Main Application
// ============================================

const App = {
    currentView: 'dashboard',
    currentClient: null,

    init() {
        this.checkAuth();
        this.setupEventListeners();
        this.loadDashboard();
    },

    // ============ AUTH ============
    checkAuth() {
        if (!Storage.isAuthenticated()) {
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        } else {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
        }
    },

    login(password) {
        if (password === SETTINGS.adminPassword) {
            Storage.login();
            this.checkAuth();
            this.loadDashboard();
            return true;
        }
        return false;
    },

    logout() {
        Storage.logout();
        this.checkAuth();
    },

    // ============ EVENT LISTENERS ============
    setupEventListeners() {
        // Login
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('loginPassword').value;
            if (!this.login(password)) {
                alert('❌ Senha incorreta!');
            }
        });

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => {
            if (confirm('Deseja sair?')) {
                this.logout();
            }
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
            });
        });

        // Add Client Button
        document.getElementById('addClientBtn').addEventListener('click', () => {
            this.openClientModal();
        });

        // Client Form
        document.getElementById('clientForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveClient();
        });

        // Modal Close
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeModal();
            });
        });

        // Search Clients
        document.getElementById('searchClients')?.addEventListener('input', (e) => {
            this.filterClients(e.target.value);
        });

        // Filter Status
        document.getElementById('filterStatus')?.addEventListener('change', (e) => {
            this.filterClients(document.getElementById('searchClients').value, e.target.value);
        });

        // Setup Script
        document.getElementById('runSetupScript')?.addEventListener('click', () => {
            this.runSetupScript();
        });
    },

    // ============ NAVIGATION ============
    switchView(viewName) {
        // Update nav
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === viewName) {
                item.classList.add('active');
            }
        });

        // Update views
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        document.getElementById(viewName + 'View').classList.add('active');

        // Update title
        const titles = {
            dashboard: 'Dashboard',
            clients: 'Gerenciar Clientes',
            finance: 'Financeiro',
            stats: 'Estatísticas',
            setup: 'Novo Setup'
        };
        document.getElementById('viewTitle').textContent = titles[viewName];

        // Load view data
        this.currentView = viewName;
        this[`load${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`]();
    },

    // ============ DASHBOARD ============
    loadDashboard() {
        const clients = Storage.getClients();
        const activeClients = clients.filter(c => c.status === 'ativo');
        const payments = Storage.getPayments();
        const activities = Storage.getActivities();

        // Stats
        document.getElementById('totalClients').textContent = activeClients.length;

        const monthlyRevenue = activeClients.reduce((sum, c) => {
            return sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0);
        }, 0);
        document.getElementById('monthlyRevenue').textContent = `R$ ${monthlyRevenue.toLocaleString('pt-BR')}`;

        const currentMonth = new Date().toISOString().slice(0, 7);
        const setupThisMonth = payments
            .filter(p => p.type === 'Setup' && p.date.startsWith(currentMonth))
            .reduce((sum, p) => sum + p.amount, 0);
        document.getElementById('setupRevenue').textContent = `R$ ${setupThisMonth.toLocaleString('pt-BR')}`;

        const pendingCount = clients.filter(c => c.status === 'inadimplente').length;
        document.getElementById('pendingPayments').textContent = pendingCount;

        // Upcoming payments
        this.renderUpcomingPayments(clients);

        // Recent activity
        this.renderRecentActivity(activities);
    },

    renderUpcomingPayments(clients) {
        const container = document.getElementById('upcomingPayments');
        const activeClients = clients.filter(c => c.status === 'ativo' || c.status === 'teste');

        if (activeClients.length === 0) {
            container.innerHTML = '<p style="color: var(--gray); padding: 1rem;">Nenhum pagamento pendente</p>';
            return;
        }

        container.innerHTML = activeClients.slice(0, 5).map(client => {
            const nextPaymentDate = this.getNextPaymentDate(client.installDate);
            const daysUntil = this.getDaysUntil(nextPaymentDate);
            const amount = SETTINGS.plans[client.plan]?.monthlyPrice || 0;

            return `
                <div class="list-item">
                    <div class="list-item-info">
                        <strong>${client.name}</strong>
                        <small>Vencimento: ${this.formatDate(nextPaymentDate)} (${daysUntil} dias)</small>
                    </div>
                    <span class="price">R$ ${amount}</span>
                </div>
            `;
        }).join('');
    },

    renderRecentActivity(activities) {
        const container = document.getElementById('recentActivity');

        if (activities.length === 0) {
            container.innerHTML = '<p style="color: var(--gray); padding: 1rem;">Nenhuma atividade recente</p>';
            return;
        }

        container.innerHTML = activities.slice(0, 10).map(activity => {
            return `
                <div class="list-item">
                    <div class="list-item-info">
                        <strong>${activity.message}</strong>
                        <small>${this.formatDateTime(activity.timestamp)}</small>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ============ CLIENTS ============
    loadClients() {
        this.renderClientsTable(Storage.getClients());
    },

    renderClientsTable(clients) {
        const tbody = document.getElementById('clientsTableBody');

        if (clients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--gray);">Nenhum cliente cadastrado</td></tr>';
            return;
        }

        tbody.innerHTML = clients.map(client => {
            const plan = SETTINGS.plans[client.plan];
            const nextPayment = this.getNextPaymentDate(client.installDate);

            return `
                <tr>
                    <td>
                        <strong>${client.name}</strong><br>
                        <small style="color: var(--gray);">${client.email}</small>
                    </td>
                    <td>${plan?.name || client.plan}</td>
                    <td><span class="status-badge status-${client.status}">${this.getStatusLabel(client.status)}</span></td>
                    <td><a href="${client.railwayUrl}" target="_blank" style="color: var(--primary);">Ver app</a></td>
                    <td>${this.formatDate(client.installDate)}</td>
                    <td>${this.formatDate(nextPayment)}</td>
                    <td class="table-actions-cell">
                        <button class="btn-small btn-edit" onclick="App.editClient('${client.id}')">Editar</button>
                        <button class="btn-small btn-delete" onclick="App.deleteClient('${client.id}')">Excluir</button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    filterClients(search = '', status = '') {
        let clients = Storage.getClients();

        if (search) {
            search = search.toLowerCase();
            clients = clients.filter(c =>
                c.name.toLowerCase().includes(search) ||
                c.email.toLowerCase().includes(search) ||
                c.company.toLowerCase().includes(search)
            );
        }

        if (status) {
            clients = clients.filter(c => c.status === status);
        }

        this.renderClientsTable(clients);
    },

    // ============ FINANCE ============
    loadFinance() {
        const clients = Storage.getClients();
        const activeClients = clients.filter(c => c.status === 'ativo');
        const payments = Storage.getPayments();

        const currentMonth = new Date().toISOString().slice(0, 7);

        // Monthly revenue
        const monthlyRevenue = activeClients.reduce((sum, c) => {
            return sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0);
        }, 0);

        // Setup this month
        const setupRevenue = payments
            .filter(p => p.type === 'Setup' && p.date.startsWith(currentMonth))
            .reduce((sum, p) => sum + p.amount, 0);

        const totalRevenue = monthlyRevenue + setupRevenue;

        // Railway costs
        const railwayCosts = activeClients.length * SETTINGS.railwayCostPerClient;

        // Net profit
        const netProfit = totalRevenue - railwayCosts;

        document.getElementById('financeTotal').textContent = `R$ ${totalRevenue.toLocaleString('pt-BR')}`;
        document.getElementById('railwayCosts').textContent = `R$ ${railwayCosts.toLocaleString('pt-BR')}`;
        document.getElementById('netProfit').textContent = `R$ ${netProfit.toLocaleString('pt-BR')}`;

        // Payments table
        this.renderPaymentsTable(payments);
    },

    renderPaymentsTable(payments) {
        const tbody = document.getElementById('paymentsTableBody');

        if (payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--gray);">Nenhum pagamento registrado</td></tr>';
            return;
        }

        tbody.innerHTML = payments.slice().reverse().slice(0, 20).map(payment => {
            return `
                <tr>
                    <td>${this.formatDate(payment.date)}</td>
                    <td>${payment.clientName}</td>
                    <td>${payment.type}</td>
                    <td>R$ ${payment.amount.toLocaleString('pt-BR')}</td>
                    <td><span class="status-badge status-${payment.status === 'pago' ? 'ativo' : 'inadimplente'}">${payment.status === 'pago' ? 'Pago' : 'Pendente'}</span></td>
                </tr>
            `;
        }).join('');
    },

    // ============ STATS ============
    loadStats() {
        const clients = Storage.getClients();

        const total = clients.length;
        const active = clients.filter(c => c.status === 'ativo').length;
        const test = clients.filter(c => c.status === 'teste').length;
        const conversion = test > 0 ? Math.round((active / (active + test)) * 100) : 0;

        const avgTicket = active > 0 ? clients
            .filter(c => c.status === 'ativo')
            .reduce((sum, c) => sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0), 0) / active : 0;

        const ltv = avgTicket * SETTINGS.stats.averageClientLifetimeMonths;

        document.getElementById('statsTotal').textContent = total;
        document.getElementById('statsActive').textContent = active;
        document.getElementById('statsTest').textContent = test;
        document.getElementById('statsConversion').textContent = conversion + '%';
        document.getElementById('statsAvgTicket').textContent = `R$ ${Math.round(avgTicket)}`;
        document.getElementById('statsLTV').textContent = `R$ ${Math.round(ltv).toLocaleString('pt-BR')}`;

        // Plan distribution
        this.renderPlanDistribution(clients);
    },

    renderPlanDistribution(clients) {
        const container = document.getElementById('planDistribution');
        const distribution = clients.reduce((acc, c) => {
            acc[c.plan] = (acc[c.plan] || 0) + 1;
            return acc;
        }, {});

        container.innerHTML = `
            <div style="padding: 2rem; text-align: center;">
                ${Object.entries(distribution).map(([plan, count]) => `
                    <div style="margin-bottom: 1rem;">
                        <strong>${SETTINGS.plans[plan]?.name || plan}:</strong> ${count} clientes (${Math.round(count / clients.length * 100)}%)
                    </div>
                `).join('')}
            </div>
        `;
    },

    // ============ SETUP ============
    loadSetup() {
        // Already loaded in HTML
    },

    runSetupScript() {
        alert('🔧 Script de setup:\n\nAbra o terminal e execute:\n\ncd ~/Documents/contatosync\n./setup-novo-cliente.sh\n\n(Windows: setup-novo-cliente.bat)');
    },

    // ============ CLIENT MODAL ============
    openClientModal(clientId = null) {
        const modal = document.getElementById('clientModal');
        modal.classList.add('active');

        if (clientId) {
            const client = Storage.getClientById(clientId);
            if (client) {
                document.getElementById('modalTitle').textContent = 'Editar Cliente';
                document.getElementById('clientId').value = client.id;
                document.getElementById('clientName').value = client.name;
                document.getElementById('clientEmail').value = client.email;
                document.getElementById('clientPhone').value = client.phone;
                document.getElementById('clientCompany').value = client.company;
                document.getElementById('clientPlan').value = client.plan;
                document.getElementById('clientRailwayUrl').value = client.railwayUrl;
                document.getElementById('clientGithubRepo').value = client.githubRepo;
                document.getElementById('clientStatus').value = client.status;
                document.getElementById('clientInstallDate').value = client.installDate;
                document.getElementById('clientSetupFee').value = client.setupFee;
                document.getElementById('clientNotes').value = client.notes || '';
            }
        } else {
            document.getElementById('modalTitle').textContent = 'Novo Cliente';
            document.getElementById('clientForm').reset();
            document.getElementById('clientId').value = '';
            document.getElementById('clientInstallDate').value = new Date().toISOString().split('T')[0];
        }
    },

    closeModal() {
        document.getElementById('clientModal').classList.remove('active');
    },

    saveClient() {
        const id = document.getElementById('clientId').value;
        const clientData = {
            name: document.getElementById('clientName').value,
            email: document.getElementById('clientEmail').value,
            phone: document.getElementById('clientPhone').value,
            company: document.getElementById('clientCompany').value,
            plan: document.getElementById('clientPlan').value,
            railwayUrl: document.getElementById('clientRailwayUrl').value,
            githubRepo: document.getElementById('clientGithubRepo').value,
            status: document.getElementById('clientStatus').value,
            installDate: document.getElementById('clientInstallDate').value,
            setupFee: parseInt(document.getElementById('clientSetupFee').value),
            notes: document.getElementById('clientNotes').value
        };

        if (id) {
            Storage.updateClient(id, clientData);
        } else {
            Storage.addClient(clientData);

            // Register setup payment if applicable
            if (clientData.setupFee > 0) {
                Storage.addPayment({
                    clientName: clientData.name,
                    type: 'Setup',
                    amount: clientData.setupFee,
                    status: 'pago',
                    date: clientData.installDate
                });
            }
        }

        this.closeModal();
        this.loadClients();
        this.loadDashboard();
        alert('✅ Cliente salvo com sucesso!');
    },

    editClient(id) {
        this.openClientModal(id);
    },

    deleteClient(id) {
        const client = Storage.getClientById(id);
        if (confirm(`⚠️ Tem certeza que deseja excluir o cliente "${client.name}"?`)) {
            Storage.deleteClient(id);
            this.loadClients();
            this.loadDashboard();
        }
    },

    // ============ UTILS ============
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR');
    },

    formatDateTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('pt-BR');
    },

    getNextPaymentDate(installDate) {
        const install = new Date(installDate);
        const today = new Date();
        const dayOfMonth = install.getDate();

        let nextPayment = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);

        if (nextPayment <= today) {
            nextPayment = new Date(today.getFullYear(), today.getMonth() + 1, dayOfMonth);
        }

        return nextPayment.toISOString().split('T')[0];
    },

    getDaysUntil(dateString) {
        const target = new Date(dateString);
        const today = new Date();
        const diff = target - today;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    getStatusLabel(status) {
        const labels = {
            ativo: 'Ativo',
            teste: 'Em Teste',
            inadimplente: 'Inadimplente',
            cancelado: 'Cancelado'
        };
        return labels[status] || status;
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

console.log('ContatoSync Admin Panel loaded! 🚀');
