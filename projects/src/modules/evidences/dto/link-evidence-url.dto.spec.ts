import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LinkEvidenceUrlDto } from './link-evidence-url.dto';

const body = {
  evaluationFormId: 'a2b07928-d685-4530-a6c1-01bd1a5aab15',
  criteriaCode: 'I.1',
  imageUrl: 'https://res.cloudinary.com/demo/image/upload/proof.jpg',
  publicId: 'evidences/proof',
};
const errorsFor = (input: object) =>
  validate(plainToInstance(LinkEvidenceUrlDto, input));
describe('LinkEvidenceUrlDto', () => {
  it('accepts the complete explicit request', async () => {
    expect(await errorsFor(body)).toEqual([]);
  });
  it.each([
    'evaluationFormId',
    'criteriaCode',
    'imageUrl',
    'publicId',
  ] as const)('requires %s', async (field) => {
    const incomplete: Partial<typeof body> = { ...body };
    delete incomplete[field];
    expect(
      (await errorsFor(incomplete)).map((error) => error.property),
    ).toContain(field);
  });
  it.each([
    ['evaluationFormId', 'not-a-uuid'],
    ['criteriaCode', ''],
    ['publicId', ''],
    ['imageUrl', 'http://res.cloudinary.com/demo/proof.jpg'],
    ['imageUrl', 'https://example.com/proof.jpg'],
  ])('rejects invalid %s: %s', async (field, value) => {
    expect(
      (await errorsFor({ ...body, [field!]: value })).map(
        (error) => error.property,
      ),
    ).toContain(field);
  });
});
