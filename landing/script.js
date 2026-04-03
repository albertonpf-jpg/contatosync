// ============================================
// ContatoSync - Landing Page Scripts
// ============================================

// Smooth scroll para links internos
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Form submission
document.getElementById('contactForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const formData = new FormData(this);
    const data = Object.fromEntries(formData);

    // Mostrar loading no botão
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Enviando...';
    submitBtn.disabled = true;

    try {
        // Aqui você pode integrar com:
        // - Email via FormSubmit, EmailJS, ou backend próprio
        // - WhatsApp API
        // - CRM/Google Sheets

        // Exemplo: redirecionar para WhatsApp com mensagem pré-formatada
        const mensagem = `Olá! Quero fazer um teste grátis do ContatoSync.

📋 Meus dados:
Nome: ${data.nome}
Email: ${data.email}
WhatsApp: ${data.whatsapp}
Plano escolhido: ${data.plano}`;

        const whatsappURL = `https://wa.me/5511992741845?text=${encodeURIComponent(mensagem)}`;

        // Simulando envio (remover em produção)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Redirecionar para WhatsApp
        window.open(whatsappURL, '_blank');

        // Mostrar mensagem de sucesso
        alert('✅ Dados enviados! Você será redirecionado para o WhatsApp.');

        // Limpar formulário
        this.reset();

    } catch (error) {
        console.error('Erro ao enviar formulário:', error);
        alert('❌ Erro ao enviar. Tente novamente ou entre em contato direto via WhatsApp.');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

// Animação de números (contadores)
function animateCounters() {
    const stats = document.querySelectorAll('.stat-number');

    const observerOptions = {
        threshold: 0.5,
        rootMargin: '0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const stat = entry.target;
                const finalValue = stat.textContent;

                // Animar se for número
                if (!isNaN(finalValue)) {
                    animateValue(stat, 0, parseInt(finalValue), 1000);
                }

                observer.unobserve(stat);
            }
        });
    }, observerOptions);

    stats.forEach(stat => observer.observe(stat));
}

function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = end;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Inicializar animações quando página carregar
document.addEventListener('DOMContentLoaded', () => {
    animateCounters();

    // Adicionar classe de animação aos cards quando aparecem na tela
    const cards = document.querySelectorAll('.feature-card, .pricing-card, .testimonial-card, .faq-item');

    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, index * 100);
                cardObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        cardObserver.observe(card);
    });
});

// FAQ Accordion (opcional - para expandir/recolher respostas)
document.querySelectorAll('.faq-item h3').forEach(question => {
    question.style.cursor = 'pointer';
    question.addEventListener('click', function() {
        const answer = this.nextElementSibling;
        const isOpen = answer.style.display === 'block';

        // Fechar todas as outras respostas
        document.querySelectorAll('.faq-item p').forEach(p => {
            p.style.display = 'none';
        });

        // Toggle da resposta atual
        answer.style.display = isOpen ? 'none' : 'block';
    });
});

// Inicializar FAQ fechado (opcional)
// document.querySelectorAll('.faq-item p').forEach(p => {
//     p.style.display = 'none';
// });

// Tracking de eventos (Google Analytics, Facebook Pixel, etc)
function trackEvent(eventName, params = {}) {
    // Google Analytics 4
    if (typeof gtag !== 'undefined') {
        gtag('event', eventName, params);
    }

    // Facebook Pixel
    if (typeof fbq !== 'undefined') {
        fbq('track', eventName, params);
    }

    console.log('Event tracked:', eventName, params);
}

// Trackear cliques em CTAs
document.querySelectorAll('a[href="#contato"]').forEach(btn => {
    btn.addEventListener('click', () => {
        trackEvent('cta_click', { button_location: btn.textContent.trim() });
    });
});

// Trackear seleção de plano
document.querySelector('select[name="plano"]')?.addEventListener('change', function() {
    trackEvent('plan_selected', { plan: this.value });
});

// Detectar scroll e adicionar classe ao header
let lastScroll = 0;
window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        header.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    } else {
        header.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    }

    lastScroll = currentScroll;
});

// Mobile menu toggle (se você adicionar menu hamburguer depois)
function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.nav');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('active');
        });
    }
}

// Validação de formulário em tempo real
const emailInput = document.querySelector('input[type="email"]');
if (emailInput) {
    emailInput.addEventListener('blur', function() {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.value)) {
            this.style.borderColor = '#ff6b6b';
        } else {
            this.style.borderColor = '#00C853';
        }
    });
}

const phoneInput = document.querySelector('input[type="tel"]');
if (phoneInput) {
    phoneInput.addEventListener('input', function() {
        // Máscara para telefone brasileiro (11) 99999-9999
        let value = this.value.replace(/\D/g, '');
        if (value.length > 11) value = value.slice(0, 11);

        if (value.length > 6) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
        } else if (value.length > 2) {
            value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
        } else if (value.length > 0) {
            value = `(${value}`;
        }

        this.value = value;
    });
}

// Exit intent popup (opcional - mostrar oferta quando usuário vai sair)
let exitIntentShown = false;
document.addEventListener('mouseleave', (e) => {
    if (e.clientY < 10 && !exitIntentShown) {
        exitIntentShown = true;
        // Mostrar popup com oferta especial
        // alert('Espere! Ganhe 15 dias grátis se testar agora!');
    }
});

console.log('ContatoSync Landing Page carregada! 🚀');
