// ============================================
// CONFIGURAÇÕES DO PAINEL ADMIN
// ============================================

const SETTINGS = {
    // Senha de acesso (ALTERE ISSO!)
    adminPassword: 'admin123',

    // Informações do administrador
    adminName: 'Alberto Nascimento',
    adminEmail: 'alberto@plannedmidia.com.br',
    adminWhatsApp: '+5511999999999',

    // Valores padrão dos planos
    plans: {
        basico: {
            name: 'Básico',
            monthlyPrice: 97,
            setupFee: 297,
            features: ['1 WhatsApp', 'Google OU iCloud', 'Até 300/dia']
        },
        pro: {
            name: 'Profissional',
            monthlyPrice: 147,
            setupFee: 397,
            features: ['1 WhatsApp', 'Google + iCloud', 'Ilimitado', 'Suporte prioritário']
        },
        enterprise: {
            name: 'Enterprise',
            monthlyPrice: 297,
            setupFee: 697,
            features: ['3 WhatsApp', 'Servidor dedicado', 'SLA 99.9%']
        }
    },

    // Custo médio Railway por cliente (em R$)
    railwayCostPerClient: 25,

    // Taxa de conversão USD para BRL (atualizar manualmente)
    usdToBrl: 5.00,

    // Configurações de notificação
    notifications: {
        paymentDueDays: 5, // Avisar X dias antes do vencimento
        emailReminders: true,
        whatsappReminders: false
    },

    // Estatísticas
    stats: {
        conversionTestToActive: 0.75, // 75% dos testes viram ativos
        averageClientLifetimeMonths: 12 // Tempo médio de permanência
    }
};

// Não edite abaixo desta linha
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SETTINGS;
}
