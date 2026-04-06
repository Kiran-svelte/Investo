import bcrypt from 'bcrypt';
import prisma from './prisma';
import logger from './logger';

export async function seedDatabase(options?: { disconnect?: boolean }): Promise<void> {
  const disconnect = options?.disconnect ?? false;
  try {
    logger.info('Seeding database...');

    const ensurePlan = async (input: {
      name: string;
      maxAgents: number;
      maxLeads: number | null;
      maxProperties: number | null;
      priceMonthly: number;
      priceYearly: number | null;
      features: string[];
    }) => {
      const existing = await prisma.subscriptionPlan.findFirst({
        where: { name: input.name },
        select: { id: true },
      });

      if (existing) {
        return prisma.subscriptionPlan.update({
          where: { id: existing.id },
          data: {
            maxAgents: input.maxAgents,
            maxLeads: input.maxLeads,
            maxProperties: input.maxProperties,
            priceMonthly: input.priceMonthly,
            priceYearly: input.priceYearly,
            features: input.features,
            status: 'active',
          },
        });
      }

      return prisma.subscriptionPlan.create({
        data: {
          name: input.name,
          maxAgents: input.maxAgents,
          maxLeads: input.maxLeads,
          maxProperties: input.maxProperties,
          priceMonthly: input.priceMonthly,
          priceYearly: input.priceYearly,
          features: input.features,
          status: 'active',
        },
      });
    };

    // 1. Create subscription plans
    const starterPlan = await ensurePlan({
      name: 'Starter',
      maxAgents: 3,
      maxLeads: 500,
      maxProperties: 50,
      priceMonthly: 4999,
      priceYearly: 49990,
      features: ['whatsapp_ai', 'basic_crm', 'calendar'],
    });

    const growthPlan = await ensurePlan({
      name: 'Growth',
      maxAgents: 10,
      maxLeads: 2000,
      maxProperties: 200,
      priceMonthly: 14999,
      priceYearly: 149990,
      features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation'],
    });

    const enterprisePlan = await ensurePlan({
      name: 'Enterprise',
      maxAgents: 999,
      maxLeads: null,
      maxProperties: null,
      priceMonthly: 49999,
      priceYearly: 499990,
      features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation', 'api_access', 'priority_support'],
    });

    // 2. Create a platform company for super admin
    const platformCompany = await prisma.company.upsert({
      where: { slug: 'investo-platform' },
      update: {
        name: 'Investo Platform',
        status: 'active',
        planId: enterprisePlan.id,
      },
      create: {
        name: 'Investo Platform',
        slug: 'investo-platform',
        status: 'active',
        planId: enterprisePlan.id,
      },
    });

    // 3. Create super admin user
    const passwordHash = await bcrypt.hash('admin@123', 12);
    await prisma.user.upsert({
      where: { email: 'admin@investo.in' },
      update: {
        companyId: platformCompany.id,
        name: 'Super Admin',
        passwordHash,
        role: 'super_admin',
        status: 'active',
      },
      create: {
        companyId: platformCompany.id,
        name: 'Super Admin',
        email: 'admin@investo.in',
        passwordHash,
        role: 'super_admin',
        status: 'active',
      },
    });

    // 4. Create a demo company
    const demoCompany = await prisma.company.upsert({
      where: { slug: 'demo-realty' },
      update: {
        name: 'Demo Realty',
        whatsappPhone: '+919999999999',
        status: 'active',
        planId: growthPlan.id,
      },
      create: {
        name: 'Demo Realty',
        slug: 'demo-realty',
        whatsappPhone: '+919999999999',
        status: 'active',
        planId: growthPlan.id,
      },
    });

    // 5. Create demo company admin
    const demoPassword = await bcrypt.hash('demo@123', 12);
    await prisma.user.upsert({
      where: { email: 'admin@demorealty.in' },
      update: {
        companyId: demoCompany.id,
        name: 'Demo Admin',
        passwordHash: demoPassword,
        role: 'company_admin',
        status: 'active',
      },
      create: {
        companyId: demoCompany.id,
        name: 'Demo Admin',
        email: 'admin@demorealty.in',
        passwordHash: demoPassword,
        role: 'company_admin',
        status: 'active',
      },
    });

    // 6. Create demo sales agent
    await prisma.user.upsert({
      where: { email: 'rahul@demorealty.in' },
      update: {
        companyId: demoCompany.id,
        name: 'Rahul Agent',
        passwordHash: demoPassword,
        role: 'sales_agent',
        status: 'active',
        phone: '+919876543210',
      },
      create: {
        companyId: demoCompany.id,
        name: 'Rahul Agent',
        email: 'rahul@demorealty.in',
        passwordHash: demoPassword,
        role: 'sales_agent',
        status: 'active',
        phone: '+919876543210',
      },
    });

    // 7. Create AI settings for demo company
    await prisma.aiSetting.upsert({
      where: { companyId: demoCompany.id },
      update: {
        businessName: 'Demo Realty',
        businessDescription: 'Premium real estate developer in Bangalore offering villas, apartments, and plots.',
        operatingLocations: ['Bangalore', 'Mysore', 'Hubli'],
        budgetRanges: { min: 3000000, max: 50000000 },
        responseTone: 'friendly',
        greetingTemplate: 'Welcome to Demo Realty! How can I help you find your dream property today?',
        persuasionLevel: 7,
        autoDetectLanguage: true,
        defaultLanguage: 'en',
      },
      create: {
        companyId: demoCompany.id,
        businessName: 'Demo Realty',
        businessDescription: 'Premium real estate developer in Bangalore offering villas, apartments, and plots.',
        operatingLocations: ['Bangalore', 'Mysore', 'Hubli'],
        budgetRanges: { min: 3000000, max: 50000000 },
        responseTone: 'friendly',
        greetingTemplate: 'Welcome to Demo Realty! How can I help you find your dream property today?',
        persuasionLevel: 7,
        autoDetectLanguage: true,
        defaultLanguage: 'en',
      },
    });

    // 8. Create demo properties idempotently
    const demoProperties = [
      {
        name: 'Sunrise Villas Phase 2',
        builder: 'Demo Builders',
        locationCity: 'Bangalore',
        locationArea: 'Whitefield',
        locationPincode: '560066',
        priceMin: 12000000,
        priceMax: 18000000,
        bedrooms: 3,
        propertyType: 'villa' as const,
        amenities: ['swimming_pool', 'gym', 'clubhouse', 'park', 'security'],
        description: 'Luxury 3BHK villas with modern amenities in the heart of Whitefield.',
        reraNumber: 'PRM/KA/RERA/1251/310/AG/180620/002612',
        status: 'available' as const,
      },
      {
        name: 'Green Heights Apartment',
        builder: 'Demo Builders',
        locationCity: 'Bangalore',
        locationArea: 'Electronic City',
        locationPincode: '560100',
        priceMin: 5000000,
        priceMax: 8500000,
        bedrooms: 2,
        propertyType: 'apartment' as const,
        amenities: ['gym', 'park', 'security', 'power_backup'],
        description: 'Affordable 2BHK apartments near IT corridor.',
        reraNumber: 'PRM/KA/RERA/1251/310/AG/180620/002613',
        status: 'available' as const,
      },
    ];

    for (const property of demoProperties) {
      const existingProperty = await prisma.property.findFirst({
        where: {
          companyId: demoCompany.id,
          name: property.name,
        },
        select: { id: true },
      });

      if (existingProperty) {
        await prisma.property.update({
          where: { id: existingProperty.id },
          data: property,
        });
      } else {
        await prisma.property.create({
          data: {
            companyId: demoCompany.id,
            ...property,
          },
        });
      }
    }

    logger.info('Seed completed successfully');
    logger.info('Super Admin: admin@investo.in / admin@123');
    logger.info('Demo Admin: admin@demorealty.in / demo@123');
    logger.info('Demo Agent: rahul@demorealty.in / demo@123');
  } catch (error) {
    logger.error('Seed failed', { error });
    throw error;
  } finally {
    if (disconnect) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  seedDatabase({ disconnect: true })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
