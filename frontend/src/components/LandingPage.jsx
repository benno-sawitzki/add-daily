import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Mic, Calendar, CheckCircle2, Clock, Sparkles, ArrowRight, 
  ChevronDown, Star, Zap, Shield, Users, Play, Menu, X
} from 'lucide-react';
import AuthModal from './AuthModal';

const LandingPage = () => {
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const openLogin = () => setAuthModal({ open: true, mode: 'login' });
  const openSignup = () => setAuthModal({ open: true, mode: 'signup' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white overflow-x-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-slate-900/90 backdrop-blur-lg border-b border-white/5' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                ADD Daily
              </span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-white/70 hover:text-white transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm text-white/70 hover:text-white transition-colors">How it Works</a>
              <a href="#pricing" className="text-sm text-white/70 hover:text-white transition-colors">Pricing</a>
              <a href="#faq" className="text-sm text-white/70 hover:text-white transition-colors">FAQ</a>
            </div>

            {/* Auth Buttons */}
            <div className="hidden md:flex items-center gap-3">
              <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10" onClick={openLogin}>
                Log in
              </Button>
              <Button className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white border-0" onClick={openSignup}>
                Get Started Free
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-slate-900/95 backdrop-blur-lg border-t border-white/5">
            <div className="px-4 py-4 space-y-3">
              <a href="#features" className="block py-2 text-white/70 hover:text-white">Features</a>
              <a href="#how-it-works" className="block py-2 text-white/70 hover:text-white">How it Works</a>
              <a href="#pricing" className="block py-2 text-white/70 hover:text-white">Pricing</a>
              <a href="#faq" className="block py-2 text-white/70 hover:text-white">FAQ</a>
              <div className="pt-3 flex flex-col gap-2">
                <Button variant="outline" className="w-full border-white/20 text-white" onClick={openLogin}>Log in</Button>
                <Button className="w-full bg-gradient-to-r from-purple-500 to-cyan-500" onClick={openSignup}>Get Started Free</Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 md:pt-40 pb-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8 animate-fade-in">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-white/80">AI-Powered Task Management</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6 animate-fade-in-up">
            <span className="bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
              Speak Your Tasks.
            </span>
            <br />
            <span className="bg-gradient-to-r from-purple-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent animate-gradient">
              Watch Them Organize.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-10 animate-fade-in-up delay-100">
            Transform your voice into a perfectly prioritized schedule. 
            ADD Daily uses AI to understand, prioritize, and calendar your tasks — 
            so you can focus on what matters.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-fade-in-up delay-200">
            <Button 
              size="lg" 
              className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white text-lg px-8 py-6 rounded-xl shadow-2xl shadow-purple-500/25 group"
              onClick={openSignup}
            >
              Start Free Today
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="w-full sm:w-auto border-white/20 text-white hover:bg-white/10 text-lg px-8 py-6 rounded-xl"
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <Play className="w-5 h-5 mr-2" />
              See How It Works
            </Button>
          </div>

          {/* Hero Visual */}
          <div className="relative max-w-4xl mx-auto animate-fade-in-up delay-300">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent z-10 pointer-events-none" />
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-purple-500/20 bg-slate-900/50 backdrop-blur-sm">
              {/* App Preview Mock */}
              <div className="aspect-video bg-gradient-to-br from-slate-800 to-slate-900 p-8 flex items-center justify-center">
                <div className="w-full max-w-2xl">
                  {/* Voice Input UI Mock */}
                  <div className="bg-slate-800/80 rounded-2xl p-6 border border-white/10 mb-4">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center animate-pulse">
                        <Mic className="w-8 h-8 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="h-3 bg-white/20 rounded-full w-3/4 mb-2" />
                        <div className="h-3 bg-white/10 rounded-full w-1/2" />
                      </div>
                    </div>
                    <p className="text-white/60 text-sm italic">&quot;Call John for an hour, then prepare the presentation which takes 2 hours, and send a quick email...&quot;</p>
                  </div>
                  {/* Task Cards Mock */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 bg-rose-500/20 border border-rose-500/30 rounded-lg p-3">
                      <div className="w-3 h-3 rounded-full bg-rose-500" />
                      <span className="text-sm text-white/90">Prepare presentation</span>
                      <span className="ml-auto text-xs text-white/50">2h</span>
                    </div>
                    <div className="flex items-center gap-3 bg-amber-500/20 border border-amber-500/30 rounded-lg p-3">
                      <div className="w-3 h-3 rounded-full bg-amber-500" />
                      <span className="text-sm text-white/90">Call John</span>
                      <span className="ml-auto text-xs text-white/50">1h</span>
                    </div>
                    <div className="flex items-center gap-3 bg-slate-500/20 border border-slate-500/30 rounded-lg p-3">
                      <div className="w-3 h-3 rounded-full bg-slate-500" />
                      <span className="text-sm text-white/90">Send email</span>
                      <span className="ml-auto text-xs text-white/50">15m</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scroll Indicator */}
          <div className="mt-12 animate-bounce">
            <ChevronDown className="w-6 h-6 text-white/40 mx-auto" />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative py-20 md:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-purple-400 uppercase tracking-wider">Features</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-4 mb-6">
              Everything You Need to <br className="hidden md:block" />
              <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Stay Productive</span>
            </h2>
            <p className="text-lg text-white/60 max-w-2xl mx-auto">
              Powerful features designed to transform how you manage your day.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                icon: Mic,
                title: "Voice-First Input",
                description: "Simply speak your tasks naturally. Our AI understands context, duration, and priority from your voice.",
                gradient: "from-purple-500 to-pink-500"
              },
              {
                icon: Sparkles,
                title: "AI Prioritization",
                description: "Automatically categorizes tasks by urgency and importance, ensuring you focus on what matters most.",
                gradient: "from-cyan-500 to-blue-500"
              },
              {
                icon: Calendar,
                title: "Smart Scheduling",
                description: "Drag-and-drop calendar with weekly and daily views. Resize tasks to adjust duration instantly.",
                gradient: "from-emerald-500 to-teal-500"
              },
              {
                icon: Clock,
                title: "Duration Detection",
                description: "Say 'takes 2 hours' and the AI automatically sets the right duration for your task.",
                gradient: "from-amber-500 to-orange-500"
              },
              {
                icon: CheckCircle2,
                title: "Task Management",
                description: "Mark tasks complete, move between inbox and calendar, track what's done.",
                gradient: "from-rose-500 to-pink-500"
              },
              {
                icon: Zap,
                title: "iCal Export",
                description: "Export your scheduled tasks to any calendar app with one click.",
                gradient: "from-indigo-500 to-purple-500"
              }
            ].map((feature, index) => (
              <div 
                key={index}
                className="group relative bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl p-6 md:p-8 transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-white/60">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="relative py-20 md:py-32 px-4 bg-gradient-to-b from-transparent via-indigo-950/50 to-transparent">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-cyan-400 uppercase tracking-wider">How It Works</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-4 mb-6">
              Three Steps to a <br className="hidden md:block" />
              <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Perfectly Planned Day</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              {
                step: "01",
                title: "Speak Your Tasks",
                description: "Press record and talk naturally about what you need to do. Include durations like 'takes an hour' for automatic time allocation."
              },
              {
                step: "02",
                title: "Review & Adjust",
                description: "AI extracts and prioritizes your tasks. Reorder with drag-and-drop, edit titles, and adjust durations before committing."
              },
              {
                step: "03",
                title: "Execute Your Day",
                description: "Push tasks to your calendar or inbox. Drag to reschedule, resize to adjust time, and mark complete as you go."
              }
            ].map((item, index) => (
              <div key={index} className="relative text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-white/10 mb-6">
                  <span className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-white/60">{item.description}</p>
                
                {/* Connector Line */}
                {index < 2 && (
                  <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-px bg-gradient-to-r from-purple-500/50 to-transparent" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative py-20 md:py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-purple-400 uppercase tracking-wider">Pricing</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-4 mb-6">
              Simple, <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Transparent</span> Pricing
            </h2>
            <p className="text-lg text-white/60 max-w-2xl mx-auto">
              Start free, upgrade when you need more.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 hover:border-white/20 transition-colors">
              <h3 className="text-lg font-medium text-white/80 mb-2">Free</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-white/60">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["50 voice tasks/month", "Basic AI prioritization", "Weekly calendar view", "iCal export"].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-white/70">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" onClick={openSignup}>
                Get Started
              </Button>
            </div>

            {/* Pro Plan */}
            <div className="relative bg-gradient-to-b from-purple-500/20 to-cyan-500/20 border-2 border-purple-500/50 rounded-2xl p-8 scale-105">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full text-sm font-medium">
                Most Popular
              </div>
              <h3 className="text-lg font-medium text-white mb-2">Pro</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$9</span>
                <span className="text-white/60">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["Unlimited voice tasks", "Advanced AI with GPT-5", "Daily & weekly views", "Priority support", "Custom categories"].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-white/90">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600" onClick={openSignup}>
                Start Pro Trial
              </Button>
            </div>

            {/* Team Plan */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 hover:border-white/20 transition-colors">
              <h3 className="text-lg font-medium text-white/80 mb-2">Team</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$29</span>
                <span className="text-white/60">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["Everything in Pro", "Up to 10 team members", "Shared calendars", "Team analytics", "Admin controls"].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-white/70">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" onClick={openSignup}>
                Contact Sales
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="relative py-20 md:py-32 px-4 bg-gradient-to-b from-transparent via-purple-950/30 to-transparent">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-cyan-400 uppercase tracking-wider">Testimonials</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-4 mb-6">
              Loved by <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Productive</span> People
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                quote: "ADD Daily completely changed how I manage my mornings. I just talk through my day while having coffee, and it's all organized before I finish my cup.",
                author: "Sarah Chen",
                role: "Startup Founder",
                avatar: "SC"
              },
              {
                quote: "The voice input is incredibly natural. It understands when I say 'this is urgent' or 'takes about an hour' and schedules everything perfectly.",
                author: "Marcus Johnson",
                role: "Product Manager",
                avatar: "MJ"
              },
              {
                quote: "I've tried every task app out there. This is the first one that actually works with how my brain works. Speak, review, done.",
                author: "Emily Rodriguez",
                role: "Freelance Designer",
                avatar: "ER"
              }
            ].map((testimonial, index) => (
              <div key={index} className="bg-white/5 border border-white/10 rounded-2xl p-6 md:p-8">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-white/80 mb-6 leading-relaxed">"{testimonial.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-sm font-medium">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-medium">{testimonial.author}</div>
                    <div className="text-sm text-white/60">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="relative py-20 md:py-32 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-purple-400 uppercase tracking-wider">FAQ</span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-4 mb-6">
              Frequently Asked <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Questions</span>
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: "How does the voice input work?",
                a: "Simply press the record button and speak naturally about your tasks. Our AI uses advanced speech recognition to transcribe your voice, then extracts individual tasks, understands their priority, and even detects mentioned durations like 'takes an hour' or '30 minutes'."
              },
              {
                q: "What AI models do you use?",
                a: "We use OpenAI's latest models including GPT-5 for task extraction and Whisper for speech-to-text. You can also choose Claude or other AI providers in the settings."
              },
              {
                q: "Can I use ADD Daily without voice input?",
                a: "Absolutely! While voice is our primary input method, you can also type your tasks directly. The AI will still extract and prioritize them the same way."
              },
              {
                q: "Is my data secure?",
                a: "Yes, we take security seriously. All data is encrypted in transit and at rest. We never share your task data with third parties, and you can delete your account and all associated data at any time."
              },
              {
                q: "Does it work with other calendar apps?",
                a: "Yes! You can export your scheduled tasks as an iCal file, which works with Google Calendar, Apple Calendar, Outlook, and any other calendar app that supports .ics files."
              },
              {
                q: "Can I try it before paying?",
                a: "Yes! Our free plan includes 50 voice tasks per month with full functionality. It's enough for most personal users, and you can upgrade to Pro anytime for unlimited usage."
              }
            ].map((faq, index) => (
              <details key={index} className="group bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between p-6 cursor-pointer list-none hover:bg-white/5 transition-colors">
                  <span className="font-medium pr-4">{faq.q}</span>
                  <ChevronDown className="w-5 h-5 text-white/60 group-open:rotate-180 transition-transform flex-shrink-0" />
                </summary>
                <div className="px-6 pb-6 text-white/70">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 md:py-32 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-br from-purple-500/20 via-indigo-500/20 to-cyan-500/20 border border-white/10 rounded-3xl p-8 md:p-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Ready to Transform <br className="hidden md:block" />
              Your Productivity?
            </h2>
            <p className="text-lg text-white/60 mb-8 max-w-xl mx-auto">
              Join thousands of people who've already simplified their task management with ADD Daily.
            </p>
            <Button 
              size="lg" 
              className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white text-lg px-10 py-6 rounded-xl shadow-2xl shadow-purple-500/25 group"
              onClick={openSignup}
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <p className="text-sm text-white/50 mt-4">No credit card required</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <Mic className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold">ADD Daily</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-white/60">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Contact</a>
            </div>
            <p className="text-sm text-white/40">© 2025 ADD Daily. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal 
        open={authModal.open} 
        mode={authModal.mode}
        onClose={() => setAuthModal({ ...authModal, open: false })}
        onSwitchMode={(mode) => setAuthModal({ ...authModal, mode })}
      />

      {/* Custom Styles */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out forwards;
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.6s ease-out forwards;
        }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-1000 { animation-delay: 1s; }
      `}</style>
    </div>
  );
};

export default LandingPage;
