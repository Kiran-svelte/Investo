import { buildSystemPrompt } from '../../services/agent/prompts/system-prompt';

describe('buildSystemPrompt', () => {
  it('includes visit context, history, and available tools', () => {
    const prompt = buildSystemPrompt({
      userName: 'Kiran',
      companyName: 'Palm',
      userRole: 'sales_agent',
      currentDateIST: '05/06/2026',
      currentTimeIST: '10:30 am',
      conversationHistory: [
        { role: 'user', content: 'When is my visit?' },
        { role: 'assistant', content: 'Checking your schedule.' },
      ],
      upcomingVisits: [
        {
          id: 'visit-1',
          projectName: 'Sunset Heights',
          date: 'Sat, 6 Jun',
          time: '1:00 pm',
          status: 'scheduled',
        },
      ],
      leadStatus: {
        id: 'lead-1',
        status: 'visit_scheduled',
        lastInteraction: '05/06/2026, 10:00 am',
        interestedProject: 'Sunset Heights',
      },
      recentErrors: [],
      availableTools: ['listVisitsToday', 'scheduleVisit', 'updateLeadStatus'],
    });

    expect(prompt).toContain('Sunset Heights');
    expect(prompt).toContain('When is my visit?');
    expect(prompt).toContain('listVisitsToday');
    expect(prompt).toContain('CONTEXT AWARENESS');
  });
});
