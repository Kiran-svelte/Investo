import React from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

const PrivacyPolicyPage: React.FC = () => (
  <div className="min-h-screen bg-gray-50 px-4 py-10">
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Building2 className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investo Privacy Policy</h1>
          <p className="text-sm text-gray-500">Last updated: June 2026</p>
        </div>
      </div>

      <div className="space-y-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 text-sm leading-relaxed text-gray-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">1. Who we are</h2>
          <p>
            Investo is a real-estate operations platform used by agencies to manage leads, properties,
            site visits, team members, and WhatsApp conversations. This policy explains what data we
            collect, why we collect it, and how we protect it.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">2. Data we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account data: name, email, phone, role, company affiliation, login timestamps.</li>
            <li>Business data: properties, leads, visit schedules, notes, and audit logs entered by your agency.</li>
            <li>WhatsApp data: customer phone numbers, message content, and conversation metadata when your agency connects WhatsApp.</li>
            <li>Technical data: IP address, browser type, API usage logs, and error diagnostics (secrets are redacted from logs).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">3. How we use data</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provide and secure the Investo service (authentication, authorization, rate limiting).</li>
            <li>Enable AI-assisted WhatsApp replies configured by your agency.</li>
            <li>Send operational notifications (visit reminders, lead updates) to your team.</li>
            <li>Improve reliability and prevent abuse.</li>
          </ul>
          <p className="mt-2">We do not sell personal data to third parties.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">4. Data storage & security</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Data is stored in encrypted PostgreSQL databases hosted on Render/Supabase infrastructure.</li>
            <li>API keys and WhatsApp tokens are stored server-side only; masked values may appear in admin UI but are never embedded in frontend source code.</li>
            <li>Access is restricted by role (super admin, company admin, agent, viewer).</li>
            <li>Passwords are hashed with bcrypt; sessions use signed JWT access tokens and rotating refresh tokens.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">5. Your rights</h2>
          <p>
            Agency administrators may export operational data (where enabled), update profile information,
            and request account deactivation. End-customers interacting via WhatsApp should contact the
            agency that owns the conversation for data requests.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-900">6. Contact</h2>
          <p>
            For privacy questions, contact your Investo platform administrator or email the agency
            that invited you to the platform.
          </p>
        </section>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        <Link to="/login" className="text-blue-600 hover:underline">Back to login</Link>
      </p>
    </div>
  </div>
);

export default PrivacyPolicyPage;
