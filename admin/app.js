// ============================================
// CONTATOSYNC ADMIN - Main Application
// v2.0 - Deploy: 2026-04-03 21:30
// ============================================

const App = {
    currentView: 'dashboard',
    currentClient: null,

    init() {
        console.log('🚀 ContatoSync Admin v2.0 - Inicializado em:', new Date().toLocaleString('pt-BR'));
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
            item.addEventListener('click', async (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                await this.switchView(view);
            });
        });

        // Add Client Buttons (múltiplos botões nas páginas)
        document.querySelectorAll('.btn-add-client').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openClientModal();
            });
        });

        document.getElementById('addFirstClient')?.addEventListener('click', () => {
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
            const statusFilter = document.getElementById('filterStatus')?.value || '';
            this.filterClients(e.target.value, statusFilter);
        });

        // Filter Status
        document.getElementById('filterStatus')?.addEventListener('change', (e) => {
            const searchFilter = document.getElementById('searchClients')?.value || '';
            this.filterClients(searchFilter, e.target.value);
        });

        // Setup Script
        document.getElementById('runSetupScript')?.addEventListener('click', () => {
            this.runSetupScript();
        });
    },

    // ============ NAVIGATION ============
    async switchView(viewName) {
        console.log(`📄 Mudando para view: ${viewName}`);

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

        // Update title (se o elemento existir)
        const titles = {
            dashboard: 'Dashboard',
            clients: 'Gerenciar Clientes',
            finance: 'Financeiro',
            stats: 'Estatísticas',
            setup: 'Novo Setup'
        };
        const viewTitleEl = document.getElementById('viewTitle');
        if (viewTitleEl) {
            viewTitleEl.textContent = titles[viewName];
        }

        // Load view data
        this.currentView = viewName;
        const loadMethod = `load${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`;
        if (typeof this[loadMethod] === 'function') {
            console.log(`⏳ Carregando dados com ${loadMethod}()...`);
            await this[loadMethod]();
            console.log(`✅ ${loadMethod}() concluído`);
        }
    },

    // ============ DASHBOARD ============
    async loadDashboard() {
        const clients = await Storage.getClients();
        const activeClients = clients.filter(c => c.status === 'ativo');
        const payments = await Storage.getPayments();
        const activities = await Storage.getActivities();

        // Stats
        document.getElementById('totalClients').textContent = activeClients.length;

        const monthlyRevenue = activeClients.reduce((sum, c) => {
            return sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0);
        }, 0);
        document.getElementById('monthlyRevenue').textContent = `R$ ${monthlyRevenue.toLocaleString('pt-BR')}`;

        const currentMonth = new Date().toISOString().slice(0, 7);
        const setupThisMonth = payments
            .filter(p => p.type === 'Setup' && p.date && p.date.startsWith(currentMonth))
            .reduce((sum, p) => sum + (p.amount || 0), 0);
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
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p>Nenhum vencimento próximo</p>
                </div>
            `;
            return;
        }

        container.innerHTML = activeClients.slice(0, 5).map(client => {
            const nextPaymentDate = this.getNextPaymentDate(client.install_date || client.installDate);
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
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    <p>Nenhuma atividade recente</p>
                </div>
            `;
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
    async loadClients() {
        const clients = await Storage.getClients();
        this.renderClientsTable(clients);
    },

    renderClientsTable(clients) {
        const tbody = document.getElementById('clientsTableBody');

        // Se o elemento não existe (não está na view clients), não faz nada
        if (!tbody) {
            console.warn('⚠️ renderClientsTable: elemento clientsTableBody não encontrado');
            return;
        }

        console.log(`📋 renderClientsTable: renderizando ${clients.length} clientes`);

        if (clients.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="7">
                        <div class="empty-state">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <p>Nenhum cliente cadastrado ainda</p>
                            <button class="btn-primary" id="addFirstClient">Adicionar Primeiro Cliente</button>
                        </div>
                    </td>
                </tr>
            `;
            // Re-attach event listener
            setTimeout(() => {
                document.getElementById('addFirstClient')?.addEventListener('click', () => {
                    this.openClientModal();
                });
            }, 0);
            return;
        }

        tbody.innerHTML = clients.map(client => {
            const plan = SETTINGS.plans[client.plan];
            const installDate = client.install_date || client.installDate;
            const nextPayment = this.getNextPaymentDate(installDate);

            return `
                <tr>
                    <td>
                        <strong>${client.name}</strong><br>
                        <small style="color: var(--gray);">${client.email || '-'}</small>
                    </td>
                    <td>${plan?.name || client.plan}</td>
                    <td><span class="status-badge status-${client.status}">${this.getStatusLabel(client.status)}</span></td>
                    <td><a href="${client.railway_url || client.railwayUrl || '#'}" target="_blank" style="color: var(--primary);">Ver app</a></td>
                    <td>${this.formatDate(installDate)}</td>
                    <td>${this.formatDate(nextPayment)}</td>
                    <td class="table-actions-cell">
                        <button class="btn-small btn-edit" onclick="App.editClient('${client.id}')">Editar</button>
                        <button class="btn-small btn-delete" onclick="App.deleteClient('${client.id}')">Excluir</button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async filterClients(search = '', status = '') {
        let clients = await Storage.getClients();
        console.log(`🔍 Filtrando: search="${search}", status="${status}", total clientes: ${clients.length}`);

        if (search && search.trim() !== '') {
            search = search.toLowerCase();
            clients = clients.filter(c =>
                (c.name && c.name.toLowerCase().includes(search)) ||
                (c.email && c.email.toLowerCase().includes(search)) ||
                (c.company && c.company.toLowerCase().includes(search))
            );
        }

        if (status && status.trim() !== '') {
            clients = clients.filter(c => c.status === status);
            console.log(`📊 Após filtro de status "${status}": ${clients.length} clientes`);
        }

        console.log(`✅ Renderizando ${clients.length} clientes`);
        this.renderClientsTable(clients);
    },

    // ============ FINANCE ============
    async loadFinance() {
        const clients = await Storage.getClients();
        const activeClients = clients.filter(c => c.status === 'ativo');
        const payments = await Storage.getPayments();

        console.log(`💰 loadFinance: ${clients.length} clientes, ${activeClients.length} ativos`);

        const currentMonth = new Date().toISOString().slice(0, 7);

        // Monthly revenue
        const monthlyRevenue = activeClients.reduce((sum, c) => {
            return sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0);
        }, 0);

        // Setup this month
        const setupRevenue = payments
            .filter(p => p.type === 'Setup' && p.date && p.date.startsWith(currentMonth))
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        const totalRevenue = monthlyRevenue + setupRevenue;

        // Railway costs
        const railwayCosts = activeClients.length * SETTINGS.railwayCostPerClient;

        // Net profit
        const netProfit = totalRevenue - railwayCosts;

        console.log(`💵 Receita: R$ ${totalRevenue}, Custos: R$ ${railwayCosts}, Lucro: R$ ${netProfit}`);

        // Atualiza os elementos apenas se existirem (proteção para quando não está na view finance)
        const totalMonthlyRevenueEl = document.getElementById('totalMonthlyRevenue');
        const railwayCostsEl = document.getElementById('railwayCosts');
        const netProfitEl = document.getElementById('netProfit');

        if (totalMonthlyRevenueEl) {
            totalMonthlyRevenueEl.textContent = `R$ ${totalRevenue.toLocaleString('pt-BR')}`;
            console.log(`✅ Elemento totalMonthlyRevenue atualizado`);
        } else {
            console.warn(`⚠️ Elemento totalMonthlyRevenue não encontrado`);
        }

        if (railwayCostsEl) {
            railwayCostsEl.textContent = `R$ ${railwayCosts.toLocaleString('pt-BR')}`;
            console.log(`✅ Elemento railwayCosts atualizado`);
        } else {
            console.warn(`⚠️ Elemento railwayCosts não encontrado`);
        }

        if (netProfitEl) {
            netProfitEl.textContent = `R$ ${netProfit.toLocaleString('pt-BR')}`;
            console.log(`✅ Elemento netProfit atualizado`);
        } else {
            console.warn(`⚠️ Elemento netProfit não encontrado`);
        }

        // Payments table
        this.renderPaymentsTable(payments);
    },

    renderPaymentsTable(payments) {
        const tbody = document.getElementById('paymentsTableBody');

        // Se o elemento não existe (não está na view finance), não faz nada
        if (!tbody) return;

        if (payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--gray);">Nenhum pagamento registrado</td></tr>';
            return;
        }

        tbody.innerHTML = payments.slice().reverse().slice(0, 20).map(payment => {
            return `
                <tr>
                    <td>${this.formatDate(payment.date)}</td>
                    <td>${payment.client_name || payment.clientName}</td>
                    <td>${payment.type}</td>
                    <td>R$ ${(payment.amount || 0).toLocaleString('pt-BR')}</td>
                    <td><span class="status-badge status-${payment.status === 'pago' ? 'ativo' : 'inadimplente'}">${payment.status === 'pago' ? 'Pago' : 'Pendente'}</span></td>
                </tr>
            `;
        }).join('');
    },

    // ============ STATS ============
    async loadStats() {
        const clients = await Storage.getClients();

        const total = clients.length;
        const active = clients.filter(c => c.status === 'ativo').length;
        const test = clients.filter(c => c.status === 'teste').length;
        const conversion = test > 0 ? Math.round((active / (active + test)) * 100) : 0;

        console.log(`📊 loadStats: Total=${total}, Ativos=${active}, Teste=${test}, Conversão=${conversion}%`);

        const avgTicket = active > 0 ? clients
            .filter(c => c.status === 'ativo')
            .reduce((sum, c) => sum + (SETTINGS.plans[c.plan]?.monthlyPrice || 0), 0) / active : 0;

        const ltv = avgTicket * SETTINGS.stats.averageClientLifetimeMonths;

        console.log(`💵 Ticket Médio: R$ ${avgTicket.toFixed(2)}, LTV: R$ ${ltv.toFixed(2)}`);

        // Atualiza elementos apenas se existirem (proteção para quando não está na view stats)
        const statsTotalEl = document.getElementById('statsTotal');
        const statsActiveEl = document.getElementById('statsActive');
        const statsTestEl = document.getElementById('statsTest');
        const statsConversionEl = document.getElementById('statsConversion');
        const statsAvgTicketEl = document.getElementById('statsAvgTicket');
        const statsLTVEl = document.getElementById('statsLTV');

        if (statsTotalEl) {
            statsTotalEl.textContent = total;
            console.log(`✅ statsTotal atualizado: ${total}`);
        } else {
            console.warn(`⚠️ Elemento statsTotal não encontrado`);
        }

        if (statsActiveEl) {
            statsActiveEl.textContent = active;
            console.log(`✅ statsActive atualizado: ${active}`);
        } else {
            console.warn(`⚠️ Elemento statsActive não encontrado`);
        }

        if (statsTestEl) {
            statsTestEl.textContent = test;
            console.log(`✅ statsTest atualizado: ${test}`);
        } else {
            console.warn(`⚠️ Elemento statsTest não encontrado`);
        }

        if (statsConversionEl) {
            statsConversionEl.textContent = conversion + '%';
            console.log(`✅ statsConversion atualizado: ${conversion}%`);
        } else {
            console.warn(`⚠️ Elemento statsConversion não encontrado`);
        }

        if (statsAvgTicketEl) {
            statsAvgTicketEl.textContent = `R$ ${Math.round(avgTicket)}`;
            console.log(`✅ statsAvgTicket atualizado: R$ ${Math.round(avgTicket)}`);
        } else {
            console.warn(`⚠️ Elemento statsAvgTicket não encontrado`);
        }

        if (statsLTVEl) {
            statsLTVEl.textContent = `R$ ${Math.round(ltv).toLocaleString('pt-BR')}`;
            console.log(`✅ statsLTV atualizado: R$ ${Math.round(ltv)}`);
        } else {
            console.warn(`⚠️ Elemento statsLTV não encontrado`);
        }

        // Plan distribution
        this.renderPlanDistribution(clients);
    },

    renderPlanDistribution(clients) {
        const container = document.getElementById('planDistribution');

        // Se o elemento não existe (não está na view stats), não faz nada
        if (!container) return;

        if (clients.length === 0) {
            container.innerHTML = '<p style="color: var(--gray); padding: 2rem; text-align: center;">Nenhum cliente cadastrado</p>';
            return;
        }

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
    async openClientModal(clientId = null) {
        const modal = document.getElementById('clientModal');
        modal.classList.add('active');

        if (clientId) {
            const client = await Storage.getClientById(clientId);
            if (client) {
                document.getElementById('modalTitle').textContent = 'Editar Cliente';
                document.getElementById('clientId').value = client.id;
                document.getElementById('clientName').value = client.name;
                document.getElementById('clientEmail').value = client.email || '';
                document.getElementById('clientPhone').value = client.phone || '';
                document.getElementById('clientCompany').value = client.company || '';
                document.getElementById('clientPlan').value = client.plan;
                document.getElementById('clientRailwayUrl').value = client.railway_url || client.railwayUrl || '';
                document.getElementById('clientGithubRepo').value = client.github_repo || client.githubRepo || '';
                document.getElementById('clientStatus').value = client.status;
                document.getElementById('clientInstallDate').value = client.install_date || client.installDate || '';
                document.getElementById('clientSetupFee').value = client.setup_fee || client.setupFee || 0;
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

    async saveClient() {
        const id = document.getElementById('clientId').value;
        const clientData = {
            name: document.getElementById('clientName').value,
            email: document.getElementById('clientEmail').value,
            phone: document.getElementById('clientPhone').value,
            company: document.getElementById('clientCompany').value,
            plan: document.getElementById('clientPlan').value,
            railway_url: document.getElementById('clientRailwayUrl').value,
            github_repo: document.getElementById('clientGithubRepo').value,
            status: document.getElementById('clientStatus').value,
            install_date: document.getElementById('clientInstallDate').value,
            setup_fee: parseFloat(document.getElementById('clientSetupFee').value) || 0,
            monthly_fee: SETTINGS.plans[document.getElementById('clientPlan').value]?.monthlyPrice || 0,
            notes: document.getElementById('clientNotes').value
        };

        try {
            if (id) {
                await Storage.updateClient(id, clientData);
            } else {
                await Storage.addClient(clientData);

                // Register setup payment if applicable
                if (clientData.setup_fee > 0) {
                    await Storage.addPayment({
                        client_name: clientData.name,
                        type: 'Setup',
                        amount: clientData.setup_fee,
                        status: 'pago',
                        date: clientData.install_date
                    });
                }
            }

            this.closeModal();

            console.log('🔄 Atualizando TODAS as views após salvar cliente...');

            // Atualizar TODAS as páginas (não só a atual)
            await this.loadClients();
            await this.loadDashboard();
            await this.loadFinance();
            await this.loadStats();

            console.log('✅ TODAS as views atualizadas com sucesso');

            alert('✅ Cliente salvo com sucesso!');
        } catch (error) {
            console.error('Erro ao salvar cliente:', error);
            alert('❌ Erro ao salvar cliente. Verifique o console.');
        }
    },

    editClient(id) {
        this.openClientModal(id);
    },

    async deleteClient(id) {
        const client = await Storage.getClientById(id);
        if (client && confirm(`⚠️ Tem certeza que deseja excluir o cliente "${client.name}"?`)) {
            await Storage.deleteClient(id);
            await this.loadClients();
            await this.loadDashboard();
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
        if (!installDate) return null;
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
        if (!dateString) return 0;
        const target = new Date(dateString);
        const today = new Date();
        const diff = target - today;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    getStatusLabel(status) {
        const labels = {
            ativo: 'Ativo',
            teste: 'Em Teste',
            inativo: 'Inativo',
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
