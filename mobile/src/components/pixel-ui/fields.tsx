import { Pressable, View } from 'react-native';
import { ARCHETYPES, AVATARS, BUDGETS, keepAnswers, questionsFor } from '../../constants/archetypes';
import type { Budget, ProfileInput } from '../../types/api';
import { C, Chip, Panel, Row, Txt } from './index';

// Profile inputs shared by onboarding and the Profile tab, so the two never drift apart.
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(v => v !== x) : [...xs, x]);

export function AvatarPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <Panel>
      <Txt>PICK AVATAR:</Txt>
      <Row>
        {AVATARS.map(a => (
          <Pressable key={a} onPress={() => onChange(a)} accessibilityRole="radio" accessibilityLabel={`Avatar ${a}`}
            accessibilityState={{ selected: a === value }}
            style={{ borderWidth: 3, borderColor: a === value ? C.gold : 'transparent', padding: 6, minWidth: 44, minHeight: 44 }}>
            <Txt size={24} style={{ lineHeight: 34 }}>{a}</Txt>
          </Pressable>
        ))}
      </Row>
    </Panel>
  );
}

export function ArchetypePicker({ value, onChange }: { value: string[]; onChange: (a: string[]) => void }) {
  return (
    <Panel>
      <Txt color={C.dim} size={8}>Pick 1 or more</Txt>
      <Row>
        {ARCHETYPES.map(a => (
          <Chip key={a.id} label={`${a.icon} ${a.name}`} on={value.includes(a.id)} onPress={() => onChange(toggle(value, a.id))} />
        ))}
      </Row>
    </Panel>
  );
}

export function Quiz({ archetypes, answers, onChange }: {
  archetypes: string[]; answers: Record<string, string>; onChange: (a: Record<string, string>) => void;
}) {
  return (
    <View style={{ gap: 16 }}>
      {questionsFor(archetypes).map(q => (
        <Panel key={q.id}>
          <Txt>{q.text}</Txt>
          <Row>
            {q.options.map(o => (
              <Chip key={o} radio label={o.toUpperCase()} on={answers[q.id] === o} onPress={() => onChange({ ...answers, [q.id]: o })} />
            ))}
          </Row>
        </Panel>
      ))}
    </View>
  );
}

export const quizComplete = (archetypes: string[], answers: Record<string, string>) =>
  questionsFor(archetypes).every(q => answers[q.id]);

export function Prefs({ wants, budget, onWants, onBudget }: {
  wants: string[]; budget: Budget; onWants: (w: string[]) => void; onBudget: (b: Budget) => void;
}) {
  return (
    <>
      <Panel>
        <Txt>WANT TO MEET:</Txt>
        <Txt color={C.dim} size={8}>None picked = anyone</Txt>
        <Row>
          {ARCHETYPES.map(a => (
            <Chip key={a.id} label={`${a.icon} ${a.name}`} on={wants.includes(a.id)} onPress={() => onWants(toggle(wants, a.id))} />
          ))}
        </Row>
      </Panel>
      <Panel>
        <Txt>BUDGET:</Txt>
        <Row>
          {BUDGETS.map(([id, label]) => <Chip key={id} radio label={label} on={budget === id} onPress={() => onBudget(id)} />)}
        </Row>
      </Panel>
    </>
  );
}

// What gets sent to the server: answers for un-picked classes are dropped.
export const toProfileInput = (p: ProfileInput): ProfileInput => ({ ...p, answers: keepAnswers(p.archetypes, p.answers) });
