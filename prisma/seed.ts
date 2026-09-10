import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuidv7 } from 'uuid';

import {
  ContentType,
  LearningUnitStatus,
  type Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('POSTGRES_URL is not set.');
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const tags: Prisma.TagCreateInput[] = [
  {
    id: uuidv7(),
    code: 'AI',
    label: 'Artificial Intelligence',
  },
  {
    id: uuidv7(),
    code: 'BOB',
    label: 'Learn with BOB',
  },
  {
    id: uuidv7(),
    code: 'CAREER',
    label: 'Career Growth',
  },
  {
    id: uuidv7(),
    code: 'INNOV',
    label: 'Innovation',
  },
  {
    id: uuidv7(),
    code: 'NEWS',
    label: 'In The News',
  },
  {
    id: uuidv7(),
    code: 'PROD',
    label: 'Productivity',
  },
  {
    id: uuidv7(),
    code: 'STU_DEV',
    label: 'Student Development',
  },
  {
    id: uuidv7(),
    code: 'STU_WELL',
    label: 'Student Wellbeing',
  },
  {
    id: uuidv7(),
    code: 'WELLBEING',
    label: 'Wellbeing',
  },
  {
    id: uuidv7(),
    code: 'INFRA',
    label: 'Infrastructure',
  },
  {
    id: uuidv7(),
    code: 'EDU_VOICES',
    label: 'Educator Voices',
  },
  {
    id: uuidv7(),
    code: 'EMP_ENGAGEMENT',
    label: 'Employee Engagement',
  },
  {
    id: uuidv7(),
    code: 'PDF',
    label: 'PDF',
  },
  {
    id: uuidv7(),
    code: 'LINK',
    label: 'Link',
  },
  {
    id: uuidv7(),
    code: 'INTRA',
    label: 'Intranet',
  },
];

const collections: Prisma.CollectionCreateInput[] = [
  {
    id: uuidv7(),
    title: 'Artificial Intelligence',
    description:
      'Discover how AI is transforming education, unpack AI use cases, and tool suggestions to help you take charge of this rapidly changing space.',
    tag: {
      connect: {
        id: tags[0].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Learn with BOB',
    description:
      'Learn with BOB is a series that illustrates scenarios on how BOB applies the SPACES framework to change his behaviour in order to promote purposeful work at a sustainable pace.',
    tag: {
      connect: {
        id: tags[1].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Career Growth',
    description:
      'Explore the world of career growth, where we help you transform potential into performance. Learn to set ambitious yet realistic professional goals, embrace new challenges, and strive towards greater work fulfilment.',
    tag: {
      connect: {
        id: tags[2].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Innovation',
    description:
      'Breaking down strategies that can empower you to explore new ideas, invest in innovative projects, and support your creative thinking.',
    tag: {
      connect: {
        id: tags[3].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'In The News',
    description:
      'Key highlights from education related news and surveys to provide insights on the ground.',
    tag: {
      connect: {
        id: tags[4].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Productivity',
    description:
      'Learn insights and techniques for mastering time management, optimizing workflows, minimizing distractions, and achieving your goals faster.',
    tag: {
      connect: {
        id: tags[5].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Student Development',
    description:
      "We explore ways to help educators learn to manage students' emotional and physical health, ultimately helping them thrive academically and personally.",
    tag: {
      connect: {
        id: tags[6].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Student Wellbeing',
    description:
      'Explore the world of Special Educational Needs (SEN) peer support that indicates Singapore specific peer support knowledge, case studies and more to gain knowledge about SEN. This topic encompasses a variety of bite-sized content including podcasts, interactive workshops, and expert-led webinars designed to empower educators and caregivers.',
    tag: {
      connect: {
        id: tags[7].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Wellbeing',
    description:
      'This series aims to help officers be aware of potential stressors in the workplace, keep a lookout for signs of distress, have regular check-ins with colleagues, and be aware of resources that we can share with those who need help.',
    tag: {
      connect: {
        id: tags[8].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Infrastructure',
    description:
      'Summary briefs of key infrastructure updates in MOE, including device setups, connectivity and digital integrations, enabling you to work efficiently.',
    tag: {
      connect: {
        id: tags[9].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Career Growth',
    description:
      'Explore the world of career growth, where we help you transform potential into performance. Learn to set ambitious yet realistic professional goals, embrace new challenges, and strive towards greater work fulfilment.',
    tag: {
      connect: {
        id: tags[10].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Educator Voices',
    description:
      'Inspiring stories from fellow educators on how to enable learning and development within the workplace and classrooms.',
    tag: {
      connect: {
        id: tags[11].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'Employee Engagement',
    description:
      'Helping leaders make sense of Employee Engagement Survey (EES) results and practical tips to maintain staff engagement levels in the workplace.',
    tag: {
      connect: {
        id: tags[12].id,
      },
    },
    isTopic: true,
  },
  {
    id: uuidv7(),
    title: 'AI Literacy',
    description: 'Mandatory Mods for AI Literacy',
    tag: {
      connect: {
        id: tags[0].id,
      },
    },
    isTopic: false,
  },
  {
    id: uuidv7(),
    title: 'Cyber Hygiene',
    description: 'Mandatory Mods for Cyber Hygiene',
    isTopic: false,
  },
  {
    id: uuidv7(),
    title: 'Our School Stories Workshop',
    description: 'A collection of workshops and resources for sharing school stories.',
    isTopic: false,
  },
];

const questionAnswers: Prisma.QuestionAnswerCreateManyLearningUnitInput[] = [
  {
    question: 'What is the color of the sky?',
    options: ['Blue', 'Red', 'Green', 'Yellow'],
    answer: 0,
    explanation: 'Blue is the best colour!',
    order: 0,
  },
  {
    question: `This is a super long question that is going to wrap around to the next line and then some more text to see how it looks. 
- It should be long enough to wrap around to the next line and then some more text to see how it looks.
- I want to see how it looks when it wraps around to the next line and then some more text to see how it looks.`,
    options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
    answer: 1,
    explanation:
      'This is an explanation. It is a very long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long long explanation.',
    order: 1,
  },
  {
    question: 'How many days are in a week?',
    options: ['7', '8', '9', '10'],
    answer: 0,
    explanation: 'There are 7 days in a week.',
    order: 2,
  },
];

const objectives = `
### Objectives
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus lacinia odio vitae vestibulum vestibulum. Cras venenatis euismod malesuada. Nullam ac erat ante. Proin sit amet turpis nec nisl efficitur dignissim. Integer a sapien eget sapien tincidunt aliquet. Curabitur non massa nec urna vulputate facilisis. Fusce ut lectus non nulla gravida volutpat.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus lacinia odio vitae vestibulum vestibulum. Cras venenatis euismod malesuada. Nullam ac erat ante. Proin sit amet turpis nec nisl efficitur dignissim. Integer a sapien eget sapien tincidunt aliquet. Curabitur non massa nec urna vulputate facilisis. Fusce ut lectus non nulla gravida volutpat.

- **Lorem** ipsum dolor sit amet, consectetur adipiscing elit.
- **Sed** do eiusmod tempor incididunt ut labore et dolore magna aliqua.
- **Ut enim** ad minim veniam, quis nostrud exercitation ullamco laboris.
`;
const summary = `
### Summary
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus lacinia odio vitae vestibulum vestibulum. Cras venenatis euismod malesuada. Nullam ac erat ante. Proin sit amet turpis nec nisl efficitur dignissim. Integer a sapien eget sapien tincidunt aliquet. Curabitur non massa nec urna vulputate facilisis. Fusce ut lectus non nulla gravida volutpat.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus lacinia odio vitae vestibulum vestibulum. Cras venenatis euismod malesuada. Nullam ac erat ante. Proin sit amet turpis nec nisl efficitur dignissim. Integer a sapien eget sapien tincidunt aliquet. Curabitur non massa nec urna vulputate facilisis. Fusce ut lectus non nulla gravida volutpat.

- **Lorem** ipsum dolor sit amet, consectetur adipiscing elit.
- **Sed** do eiusmod tempor incididunt ut labore et dolore magna aliqua.
- **Ut enim** ad minim veniam, quis nostrud exercitation ullamco laboris.
`;

const learningUnits: Prisma.LearningUnitCreateInput[] = [
  {
    id: uuidv7(),
    title: 'AI Learning Unit 1',
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    isRequired: true,
    status: LearningUnitStatus.PUBLISHED,
    dueDate: new Date('2026-02-12'), // Required
    collections: {
      create: [
        {
          collection: {
            connect: {
              id: collections[0].id,
            },
          },
        },
        {
          collection: {
            connect: {
              id: collections[13].id,
            },
          },
        },
      ],
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'AI Learning Unit 2',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[0].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'AI Quiz',
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    isRequired: true,
    status: LearningUnitStatus.PUBLISHED,
    dueDate: new Date('2026-12-31'), // Required
    collections: {
      create: [
        {
          collection: {
            connect: {
              id: collections[0].id,
            },
          },
        },
        {
          collection: {
            connect: {
              id: collections[13].id,
            },
          },
        },
      ],
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
  },
  {
    id: uuidv7(),
    title: 'AI Video Unit',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    isRequired: true,
    collections: {
      create: [
        {
          collection: {
            connect: {
              id: collections[0].id,
            },
          },
        },
        {
          collection: {
            connect: {
              id: collections[13].id,
            },
          },
        },
      ],
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    contents: {
      create: [
        { type: ContentType.VIDEO, url: 'http://localhost:5173' },
        { type: ContentType.PODCAST, url: 'http://localhost:5173' },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'AI Podcast/Video Unit',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    isRequired: true,
    collections: {
      create: [
        {
          collection: {
            connect: {
              id: collections[0].id,
            },
          },
        },
        {
          collection: {
            connect: {
              id: collections[13].id,
            },
          },
        },
      ],
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    contents: {
      create: [
        { type: ContentType.VIDEO, url: 'http://localhost:5173' },
        { type: ContentType.PODCAST, url: 'http://localhost:5173' },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'BOB Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[1].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[1].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'BOB Learning Unit 2',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[1].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[1].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'Career Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[2].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[2].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'Innovation Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[3].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[3].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'News Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[4].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[4].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'Productivity Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',

    collections: {
      create: {
        collection: {
          connect: {
            id: collections[5].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[5].id,
            },
          },
        },
      ],
    },
    questionAnswers: {
      create: questionAnswers,
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'Our School Stories Workshop Learning Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    collections: {
      create: {
        collection: {
          connect: {
            id: collections[15].id,
          },
        },
      },
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[2].id,
            },
          },
        },
      ],
    },
    contents: {
      create: [{ type: ContentType.PODCAST, url: 'http://localhost:5173' }],
    },
  },
  {
    id: uuidv7(),
    title: 'AI Video Unit 1',
    status: LearningUnitStatus.PUBLISHED,
    summary,
    objectives,
    createdBy: 'DXD Product Team',
    collections: {
      create: [
        {
          collection: {
            connect: {
              id: collections[0].id,
            },
          },
        },
      ],
    },
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[0].id,
            },
          },
        },
      ],
    },
    contents: {
      create: [
        { type: ContentType.VIDEO, url: 'http://localhost:5173' },
        { type: ContentType.PODCAST, url: 'http://localhost:5173' },
      ],
    },
  },
];

const learningUnitSources: Prisma.LearningUnitSourcesCreateInput[] = [
  {
    id: uuidv7(),
    title: 'Learning Resource 1',
    learningUnit: {
      connect: {
        id: learningUnits[0].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[13].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 2',
    learningUnit: {
      connect: {
        id: learningUnits[1].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[12].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 3',
    learningUnit: {
      connect: {
        id: learningUnits[2].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[13].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 4',
    learningUnit: {
      connect: {
        id: learningUnits[3].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[12].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 5',
    learningUnit: {
      connect: {
        id: learningUnits[0].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[6].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 6',
    learningUnit: {
      connect: {
        id: learningUnits[1].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[13].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 7',
    learningUnit: {
      connect: {
        id: learningUnits[2].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[12].id,
            },
          },
        },
      ],
    },
  },
  {
    id: uuidv7(),
    title: 'Learning Resource 8',
    learningUnit: {
      connect: {
        id: learningUnits[3].id,
      },
    },
    sourceURL: 'http://localhost:5173',
    tags: {
      create: [
        {
          tag: {
            connect: {
              id: tags[13].id,
            },
          },
        },
      ],
    },
  },
];

async function main() {
  for (const tag of tags) {
    await db.tag.upsert({
      where: { id: tag.id },
      update: {},
      create: tag,
    });
  }

  for (const collection of collections) {
    await db.collection.upsert({
      where: { id: collection.id },
      update: {},
      create: collection,
    });
  }

  for (const learningUnit of learningUnits) {
    await db.learningUnit.upsert({
      where: { id: learningUnit.id },
      update: {},
      create: learningUnit,
    });
  }

  for (const source of learningUnitSources) {
    await db.learningUnitSources.upsert({
      where: { id: source.id },
      update: {},
      create: source,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
