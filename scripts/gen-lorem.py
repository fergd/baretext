# Generates samples/lorem-ipsum-120k.md: a ~120k-word manuscript for performance testing.
# Deterministic (fixed seed). Run: python3 scripts/gen-lorem.py
import os
import random
random.seed(120)
words = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus gravida orci odio nullam varius turpis pharetra eros bibendum nec luctus felis sollicitudin mauris integer nibh euismod vulputate vehicula donec lobortis risus etiam ullamcorper ligula congue tellus maecenas fermentum pellentesque malesuada aliquam faucibus dictum sapien cras mollis scelerisque nunc arcu augue dapibus laoreet aenean molestie feugiat habitasse platea dictumst fusce convallis imperdiet placerat urna tristique sodales mattis semper leo vivamus facilisis").split()
def sentence(lo=5, hi=18):
    s = ' '.join(random.choice(words) for _ in range(random.randint(lo, hi)))
    return s[0].upper() + s[1:] + random.choice('.....?!')
def para():
    if random.random() < 0.25:
        return '"' + sentence(3, 10)[:-1] + '," she said. "' + sentence(4, 12) + '"'
    w = ' '.join(sentence() for _ in range(random.randint(1, 6))).split()
    if random.random() < 0.15: i = random.randrange(len(w) - 1); w[i] = '*' + w[i] + '*'
    if random.random() < 0.05: i = random.randrange(len(w) - 1); w[i] = '**' + w[i] + '**'
    return ' '.join(w)
def title(n): return ' '.join(random.choice(words).capitalize() for _ in range(n))
out = ['---', 'title: Lorem Ipsum (120k test)', '---', '']
total = chapters = scenes = 0
while total < 120000:
    chapters += 1
    out += ['# ' + title(random.randint(1, 3)), '']
    for s in range(random.randint(3, 7)):
        scenes += 1
        out += (['## ' + title(random.randint(1, 4))] if s == 0 or random.random() < 0.6 else ['---']) + ['']
        for _ in range(random.randint(10, 40)):
            t = para(); total += len(t.split()); out.append(t)
            if random.random() < 0.02: out += ['', '* * *', '']
        out.append('')
open(os.path.join(os.path.dirname(__file__), '..', 'samples', 'lorem-ipsum-120k.md'), 'w').write('\n'.join(out) + '\n')
print(chapters, 'chapters,', scenes, 'scenes,', total, 'words')
