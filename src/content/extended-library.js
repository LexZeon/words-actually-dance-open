/** Original, bilingual local reading material. No online generation or translation.
 * Compact rows contain: Chinese primary | secondary | sentence | English primary |
 * secondary | sentence | sentence type. Both editions use the strict import schema.
 * Practical examples are invitations to think, not guarantees of learning gains.
 */
const groups = [
  [
    'learning',
    '学习方法',
    'Learning methods',
    [
      [
        '先说再看',
        'Say it before looking',
        [
          '回想|答案|回想一个要点，先把答案盖住。|recall|answer|Try to recall one point with the answer covered.|steps',
          '解释|蒸发|解释蒸发时，先用自己的话说一遍。|explain|water|Try to explain why a wet cloth loses water.|example',
          '核对|遗漏|核对原文，找出刚才的遗漏。|check|missing|Then check the source for a missing detail.|steps',
          '修改|说法|修改不准确的说法，再试一次。|revise|wording|You can revise the wording and try again.|summary',
        ],
      ],
      [
        '例子为什么有用',
        'Give an idea a concrete example',
        [
          '概念|例子|给概念找一个能看见的例子。|idea|example|Give an idea one concrete example.|steps',
          '摩擦|鞋底|摩擦可以从鞋底与地面的接触来想。|friction|shoe|Think of friction where a shoe meets the floor.|example',
          '差别|光滑|换成光滑地面，想想会有什么差别。|change|smooth|Imagine the change on a smooth floor.|contrast',
          '边界|条件|说清例子的边界，别省掉适用条件。|limits|conditions|State the limits and conditions of the example.|summary',
        ],
      ],
      [
        '笔记不是抄写比赛',
        'Notes that answer a question',
        [
          '问题|标题|先把笔记标题写成一个问题。|question|title|Turn the title of a note into a question.|steps',
          '要点|原因|用一句要点说明原因，回答“为什么会这样”。|point|reason|Let one point explain a reason.|example',
          '原文|位置|保留原文位置，方便以后核对。|source|location|Keep the source location for a later check.|steps',
          '取舍|整页|取舍信息，不必把整页重新抄一遍。|select|page|You can select details instead of copying a page.|contrast',
        ],
      ],
      [
        '把疑问分小',
        'Make a question smaller',
        [
          '疑问|范围|一个疑问太大时，先缩小范围。|question|scope|If a question is too broad, narrow its scope.|steps',
          '步骤|卡住|列出步骤，标出自己卡住的位置。|steps|stuck|List the steps and mark where you get stuck.|steps',
          '例题|一行|看例题时，只比较卡住的那一行。|example|line|Compare that line with a worked example.|example',
          '重试|条件|换个条件重试，看是否还会卡住。|retry|condition|Change one condition and retry the task.|summary',
        ],
      ],
      [
        '给概念找邻居',
        'Connect a concept to a neighbor',
        [
          '联系|旧知识|找出新概念与旧知识的一处联系。|link|new idea|Find a link between a new idea and an old one.|steps',
          '类比|水流|用水流类比电流，只借用部分关系。|analogy|water|An analogy with water shows only some relations.|example',
          '不同|细节|写下一处不同，别把类比当成全部细节。|difference|details|Note a difference; an analogy omits details.|contrast',
          '说明|关系|说明两个概念的关系，比只画连线更清楚。|explain|link|You can explain the link instead of drawing a line.|summary',
        ],
      ],
      [
        '分开两种相似方法',
        'Tell similar methods apart',
        [
          '比较|条件|比较两种方法分别需要什么条件。|compare|conditions|First compare the conditions of two methods.|steps',
          '排序|查找|排序整理顺序，查找寻找目标。|sorting|search|In sorting, items get ordered; a search seeks a target.|contrast',
          '选择|目标|给一个小任务，再按目标选择方法。|choose|goal|For a small task, choose a method by its goal.|example',
          '理由|名字|说出选择理由，不只背方法名字。|reason|name|Give a reason, rather than only a method name.|summary',
        ],
      ],
      [
        '让错题留下线索',
        'Leave a useful clue after an error',
        [
          '错误|位置|记录错误发生在哪一步的位置。|error|step|Record the step where an error happened.|steps',
          '单位|米|把厘米当米，是单位没有核对。|units|meters|Confusing centimeters with meters mixes units.|example',
          '检查|标签|给检查单加一项：先看单位标签。|checklist|units|Add units to a small checklist.|steps',
          '新题|验证|用一道新题验证这条提醒是否有用。|new task|test|Use a new task to test that reminder.|summary',
        ],
      ],
      [
        '复习留到另一个时刻',
        'Return at another time',
        [
          '复习|时间|把复习分到不同时间试一试。|review|times|Try to review at separate times.|steps',
          '回忆|词义|下次先回忆词义，再打开笔记。|recall|meaning|Next time, recall the meaning before looking.|example',
          '调整|表现|根据自己的表现调整下次安排。|adjust|result|Use the result to adjust the next session.|steps',
          '间隔|任务|合适间隔会随任务与目标改变。|gap|task|A useful gap depends on the task and goal.|fact',
        ],
      ],
      [
        '跟不上时减一点',
        'Reduce the load when needed',
        [
          '暂停|一句|跟不上时，先暂停在当前这一句。|pause|sentence|If it is too fast, pause on this sentence.|steps',
          '拆分|要点|把长解释拆分成两个小要点。|split|points|You can split a long explanation into two small points.|example',
          '干扰|音乐|如果音乐成为干扰，可以静音再读。|music|distracts|If music distracts you, try reading in silence.|steps',
          '理解|速度|按理解调整速度，不必追赶动画。|pace|meaning|Set the pace for meaning, not for the animation.|summary',
        ],
      ],
      [
        '教给假想的新手',
        'Explain it to a beginner',
        [
          '新手|术语|向新手解释时，先少用一个术语。|beginner|jargon|For a beginner, replace one piece of jargon.|steps',
          '缓存|副本|把缓存说成临时留着的一份副本。|cache|copy|A cache can keep a copy for reuse.|example',
          '追问|失效|再追问：副本什么时候可能失效？|ask|stale|Then ask when that copy could become stale.|example',
          '补充|限制|补充这个限制，让解释更完整。|limit|explanation|Add that limit to the explanation.|summary',
        ],
      ],
    ],
  ],
  [
    'writing',
    '表达写作',
    'Expression and writing',
    [
      [
        '先写读者要知道的',
        'Start with what the reader needs',
        [
          '读者|问题|动笔前，想想读者最先会问什么问题。|reader|question|Start with the reader’s first question.|steps',
          '结果|开头|写进度邮件时，把结果放在开头。|result|opening|Put the result in the opening of a progress note.|example',
          '背景|细节|背景只补理解结果需要的细节。|context|details|Add context and details needed for that result.|steps',
          '删除|绕路|删除让读者绕路的重复铺垫。|remove|detours|You can remove repeated detours.|summary',
        ],
      ],
      [
        '把抽象词落到动作',
        'Replace an abstraction with an action',
        [
          '具体|动作|具体的动作常比空泛口号容易看懂。|actions|slogan|Specific actions can be clearer than a slogan.|fact',
          '改写|按钮|把“改善体验”改写成“让按钮更好找”。|rewrite|button|Try a rewrite: make the button easier to find.|example',
          '对象|谁|再补上对象：让谁更容易找到？|who|object|Ask who needs to find that object.|steps',
          '观察|变化|这样才知道应该观察什么变化。|observe|change|Now decide what change to observe.|summary',
        ],
      ],
      [
        '一句话只拐一次弯',
        'Give a sentence one main turn',
        [
          '主线|一句|先找出一句话要说的主线。|point|sentence|Find the main point of a sentence.|steps',
          '短句|天气|“天气变冷，带件外套”，可以保持短句。|short|jacket|A short note can say: it is cold; bring a jacket.|example',
          '插入|支线|插入太多支线时，读者可能忘了开头。|detours|opening|Too many detours can hide the opening point.|fact',
          '顺序|补充|把补充信息放到下一句，保持顺序。|next|details|Put extra details in the next sentence.|steps',
        ],
      ],
      [
        '例子要回答正文',
        'Make an example serve the point',
        [
          '例子|观点|一个例子应说明眼前这个观点。|example|point|Let an example explain the current point.|steps',
          '对比|杯子|讲容量时，对比两个大小不同的杯子。|capacity|cups|To explain capacity, compare two cups.|example',
          '岔题|花纹|杯子花纹若无关，就别为它岔题。|pattern|topic|A cup’s pattern may be outside this topic.|contrast',
          '回扣|结论|例子说完，回扣它说明的结论。|return|point|After the example, return to the point.|summary',
        ],
      ],
      [
        '标题别替内容夸口',
        'Let a title match its contents',
        [
          '标题|范围|让标题准确说出这段内容的范围。|title|scope|Let the title state the scope accurately.|steps',
          '清单|三步|只介绍三步，就把它叫作三步清单。|three steps|list|If there are three steps, call it a short list.|example',
          '绝对|证据|“永远有效”这样的绝对词需要证据。|always|evidence|Words like always need strong evidence.|contrast',
          '核实|承诺|发布前核实标题是否兑现了承诺。|check|promise|You can check whether the text keeps the title’s promise.|summary',
        ],
      ],
      [
        '用动词分配责任',
        'Use a verb to show responsibility',
        [
          '动词|动作|选一个能说明实际动作的动词。|verb|action|Choose a verb that names the actual action.|steps',
          '负责人|整理|“小林整理清单”点明负责人，比“处理中”清楚。|owner|sort|"Lin will sort the list" names an owner.|example',
          '时间|完成|如果有截止时间，再写何时完成。|deadline|finish|If there is a deadline, say when to finish.|steps',
          '确认|责任|读一遍，确认责任没有藏在句子里。|check|duty|You can check that the duty is clear in the sentence.|summary',
        ],
      ],
      [
        '把修改分两轮',
        'Edit in two separate passes',
        [
          '结构|顺序|第一轮修改只看结构与顺序。|structure|order|On the first pass, check structure and order.|steps',
          '理由|结论|检查理由是否能支持前面的结论。|reasons|claim|Check whether the reasons support the claim.|steps',
          '措辞|第二轮|第二轮再调整措辞与标点。|wording|pass|On the next pass, edit wording and punctuation.|steps',
          '分工|问题|两轮分工，是为了分开看不同问题。|passes|issues|Separate passes help you inspect different issues.|summary',
        ],
      ],
      [
        '引用旁边留下出处',
        'Keep a source beside a quotation',
        [
          '引用|原话|引用别人的原话时，清楚标出边界。|quote|words|Make clear which words belong to a quote.|steps',
          '出处|位置|在旁边留下出处和具体位置。|source|location|Keep the source and location beside it.|steps',
          '转述|原意|转述可以换说法，但不能改变原意。|paraphrase|meaning|A paraphrase should retain the meaning.|contrast',
          '核对|上下文|核对上下文，避免只取方便的一半。|context|check|You can check the context, not just a useful fragment.|summary',
        ],
      ],
      [
        '反馈要指向一句话',
        'Point feedback at a specific sentence',
        [
          '反馈|位置|反馈先指出具体位置，再说明原因。|feedback|location|Give feedback with a location and a reason.|steps',
          '疑问|第二句|例如：第二句的“它”指什么，我有疑问。|second line|it|In the second line, what does it refer to?|example',
          '建议|名词|建议把代词换成对应的名词。|noun|pronoun|Try using the noun instead of the pronoun.|steps',
          '选择|作者|把建议交给作者选择，不替他猜意图。|author|choice|Leave the author a choice instead of guessing.|summary',
        ],
      ],
      [
        '用朗读找绊脚处',
        'Listen for a sentence that catches',
        [
          '朗读|节奏|轻声朗读，听听句子的节奏。|read aloud|rhythm|You can read aloud and notice the sentence rhythm.|steps',
          '停顿|长句|如果长句让人没处停顿，就检查结构。|pause|long line|If a long line leaves no pause, check its shape.|example',
          '重复|词语|重复词语有时强调，有时只是多余。|repeated|words|Some repeated words add emphasis; others add clutter.|contrast',
          '调整|目的|按表达目的调整，不必全改成短句。|adjust|purpose|You can adjust for purpose; not every line must shrink.|summary',
        ],
      ],
    ],
  ],
  [
    'collaboration',
    '协作工作',
    'Working together',
    [
      [
        '交接别只发附件',
        'A handoff needs more than a file',
        [
          '交接|状态|交接时，先说清现在的状态。|handoff|status|Start a handoff with the current status.|steps',
          '附件|版本|发附件时，说明哪一份是当前版本。|file|version|Say which file is the current version.|example',
          '待办|负责人|把剩下的待办交给明确的负责人。|owner|next step|Name an owner for the next step.|steps',
          '缺口|提问|留下已知缺口，让接手的人能提问。|gaps|questions|List known gaps so the next person can ask questions.|summary',
        ],
      ],
      [
        '开会前有个目的',
        'Give a meeting a purpose',
        [
          '会议|目的|开会议前，写清这次的目的。|meeting|purpose|Write down the purpose of this meeting.|steps',
          '决定|颜色|要决定封面颜色，就带上两个候选。|decision|covers|For a cover decision, bring two sample covers.|example',
          '讨论|决定|需要讨论的问题，不一定当场就能决定。|discussion|decision|A discussion need not end in an immediate decision.|contrast',
          '记录|下一步|结束时记录结论、负责人和下一步。|record|next step|You can record the conclusion, owner and next step.|summary',
        ],
      ],
      [
        '把请求写成可回应的问题',
        'Make a request easy to answer',
        [
          '请求|对象|请求别人帮忙时，先说明具体对象。|request|item|Make clear which item your request concerns.|steps',
          '问题|第三页|例如：第三页的问题是，图例是否清楚？|question|page three|A question on page three: is the legend clear?|example',
          '期限|反馈|补上期限，说明什么时候需要这份反馈。|feedback|deadline|State the deadline for that feedback.|steps',
          '范围|整份|缩小范围，不必让对方重读整份材料。|scope|document|A clear scope avoids rereading the whole document.|summary',
        ],
      ],
      [
        '先对齐完成的含义',
        'Agree on what done means',
        [
          '完成|标准|同一个“完成”，可能藏着不同标准。|done|standards|The word done can hide different standards.|opening',
          '海报|尺寸|做海报前，写清尺寸与交付格式。|poster|size|Before a poster task, agree on size and file type.|example',
          '检查|文件|用这些标准检查交付文件。|check|file|Use those standards to check the delivered file.|steps',
          '变更|确认|标准变更时，让相关的人重新确认。|changes|confirm|You can confirm changes with the people affected.|summary',
        ],
      ],
      [
        '反馈分开事实和偏好',
        'Separate an observation from a preference',
        [
          '观察|事实|先描述你观察到的事实。|observe|fact|First describe a fact you can observe.|steps',
          '文字|裁切|“右侧文字被裁切”指出了可检查的问题。|text|clipped|"The text on the right is clipped" is a checkable issue.|example',
          '偏好|圆角|“我偏好圆角”表达的是个人选择。|preference|corners|A preference for round corners is a personal choice.|contrast',
          '讨论|依据|分开两种反馈，讨论时更容易找依据。|feedback|basis|Separate the feedback to clarify its basis.|summary',
        ],
      ],
      [
        '更新进度要带阻碍',
        'Report a blocker with the progress',
        [
          '进度|结果|更新进度时，先说已经得到的结果。|progress|result|Start a progress note with an actual result.|steps',
          '阻碍|素材|如果还缺素材，就把阻碍明确写出。|blocker|images|If images are missing, state that blocker.|example',
          '需要|帮助|说明需要谁提供哪一种帮助。|help|person|Say what help you need and from which person.|steps',
          '预测|承诺|把完成预测与确定承诺分开表达。|estimate|promise|Keep an estimate separate from a firm promise.|contrast',
        ],
      ],
      [
        '异步留言留上下文',
        'Leave context in an async message',
        [
          '异步|稍后|异步沟通意味着对方可能稍后才看到。|async|later|An async message may be read later.|definition',
          '上下文|链接|把任务上下文和相关链接放在一起。|context|link|Include the task context and its relevant link.|steps',
          '时区|时间|提到时间时，有需要就写清时区。|time zone|time|Name the time zone when a time could be unclear.|example',
          '回复|问题|结尾留下一个明确需要回复的问题。|reply|question|End with a question that needs a reply.|summary',
        ],
      ],
      [
        '先检查接口',
        'Check where two tasks meet',
        [
          '接口|交点|两项工作的交点，可以看作接口。|interface|tasks|An interface is where two tasks meet.|definition',
          '表格|列名|一人填表格、一人读表格，先约定列名。|table|columns|If two people share a table, agree on its columns.|example',
          '样本|一行|先交换一行样本，检查理解是否一致。|sample|row|Exchange one sample row to check understanding.|steps',
          '修改|通知|修改列名时，通知需要读表的人。|change|notify|For a column change, notify the person reading it.|summary',
        ],
      ],
      [
        '意见不同先找约束',
        'Find the constraint behind a disagreement',
        [
          '分歧|约束|发生分歧时，先问各自在照顾什么约束。|disagree|limits|When you disagree, ask which limits each sees.|steps',
          '速度|质量|赶速度和查质量，可能面对同一个期限。|speed|quality|Both speed and quality may share one deadline.|example',
          '方案|代价|列出两个方案，再比较各自的代价。|options|cost|Compare the cost of two possible options.|steps',
          '共识|差异|记录已有共识，也保留尚未解决的差异。|agreement|gaps|Record the agreement and the remaining gaps.|summary',
        ],
      ],
      [
        '给文件一个可辨认的名字',
        'Give a shared file a useful name',
        [
          '文件名|内容|文件名先说明内容，不只写“最终版”。|filename|content|Let a filename identify its content.|steps',
          '日期|草稿|文件名加日期，如“海报草稿_五月三日”，更好辨认。|date|draft|Poster draft plus a date is easier to identify.|example',
          '规则|团队|和团队约定一套简单的命名规则。|team|rule|Agree on a simple naming rule with the team.|steps',
          '版本|覆盖|保留需要的版本，避免误覆盖。|version|overwrite|Keep a needed version safe from an overwrite.|summary',
        ],
      ],
    ],
  ],
  [
    'reasoning',
    '逻辑判断',
    'Reasoning and judgment',
    [
      [
        '看见一起变化不等于原因',
        'Together does not mean because',
        [
          '相关|变化|相关表示两件事有一起变化的现象。|correlation|change|A correlation describes things that change together.|definition',
          '夏天|冰淇淋|夏天冰淇淋卖得多，游泳的人也多。|summer|ice cream|In summer, ice cream sales and swimming may rise.|example',
          '原因|天气|天气可能是同时影响这两种变化的共同原因。|weather|cause|The weather may be a shared cause.|fact',
          '证据|因果|要判断因果，还需要更多证据。|cause|evidence|A claim about cause needs more evidence.|summary',
        ],
      ],
      [
        '样本从哪里来',
        'Ask where the sample came from',
        [
          '样本|总体|样本是总体中被选来观察的一部分。|sample|group|A sample is part of the group being studied.|definition',
          '问卷|读者|只在书店发问卷，可能较常遇到读者。|survey|bookshop|A survey in a bookshop may find more readers.|example',
          '遗漏|人群|想想这种选择遗漏了哪些人群。|missing|people|Ask which people are missing from that choice.|steps',
          '结论|范围|结论的范围别比样本依据更大。|claim|sample|Keep the claim within what the sample supports.|summary',
        ],
      ],
      [
        '一个反例能做什么',
        'What one counterexample can do',
        [
          '全称|全部|“所有杯子都透明”是关于全部的全称断言。|all|claim|The claim that all cups are clear covers every cup.|definition',
          '反例|陶杯|找到一只不透明陶杯，就有了反例。|example|clay cup|An opaque clay cup is a counterexample.|example',
          '推翻|断言|这个反例足以推翻刚才的全称断言。|refute|claim|That example can refute the all-cups claim.|fact',
          '部分|仍然|它不表示透明杯子不存在，部分仍然可能成立。|some|clear cups|It does not deny that some clear cups exist.|contrast',
        ],
      ],
      [
        '平均数旁边看一眼分布',
        'Look beyond the average',
        [
          '平均|总和|平均数常用总和除以数量得到。|mean|sum|A mean is the sum divided by the count.|definition',
          '数字|相同|一和九，与五和五，平均数字相同。|average|same|One and nine have the same average as five and five.|example',
          '分布|差异|但两组分布的差异很明显。|spread|different|Their spread is quite different.|contrast',
          '范围|极端|解释平均时，也看看范围和极端值。|range|extremes|When using a mean, inspect the range and extremes.|summary',
        ],
      ],
      [
        '把假设摆到桌面上',
        'Put an assumption in view',
        [
          '假设|前提|假设是推理暂时接受的前提。|assumption|starting|An assumption is a starting point for reasoning.|definition',
          '路线|畅通|“二十分钟到达”可能假设路线畅通。|route|clear|A quick arrival may assume the route is clear.|example',
          '变化|堵车|如果堵车，这个前提就发生了变化。|traffic|changes|Extra traffic changes that starting condition.|contrast',
          '重算|估计|前提变了，就重算原来的估计。|estimate|revisit|When conditions change, revisit the estimate.|summary',
        ],
      ],
      [
        '有条件的话别漏条件',
        'Keep the condition in a claim',
        [
          '条件|结论|有些结论只在指定条件下成立。|condition|claim|A claim may hold only under a given condition.|definition',
          '室温|时间|“室温下放两小时”同时指定温度和时间。|room|two hours|Using room temperature for two hours sets conditions.|example',
          '删掉|含义|删掉其中一个，含义可能改变。|omit|meaning|If you omit one condition, the meaning may change.|contrast',
          '复述|完整|复述结论时，把重要条件一并带完整。|retell|conditions|When you retell the claim, keep its conditions.|summary',
        ],
      ],
      [
        '不确定也可以说清楚',
        'Be specific about uncertainty',
        [
          '不确定|缺口|不确定时，说清信息缺口还在哪里。|uncertain|missing|When uncertain, say what information is missing.|steps',
          '电量|关机|电脑关机，可能是电量，也可能是别的原因。|battery|shutdown|A shutdown might involve the battery or another cause.|example',
          '检查|线索|先检查电源线，补一条可用线索。|check|cable|You can check the cable to add one useful clue.|steps',
          '更新|判断|有新线索时，再更新判断。|update|evidence|You can update the judgment when new evidence arrives.|summary',
        ],
      ],
      [
        '先问比较的基准',
        'Ask what the comparison uses',
        [
          '比较|基准|看到“增加一倍”，先问比较基准。|baseline|double|If a number doubles, ask for the baseline.|steps',
          '数量|两个|从一个变两个，数量和从一百变两百不同。|one|hundred|From one to two differs from a hundred to two hundred.|example',
          '比例|绝对值|比例相同，不表示绝对值也相同。|ratio|amount|The same ratio need not mean the same amount.|contrast',
          '单位|时间|也核对两边的单位与时间范围。|units|period|Also compare the units and time period.|summary',
        ],
      ],
      [
        '证据不是音量',
        'Volume is not evidence',
        [
          '断言|语气|一句断言的语气，不决定它是否正确。|tone|claim|A confident tone does not prove a claim.|fact',
          '证据|记录|判断证据时，更该看可检查的记录，而非音量。|evidence|records|Look for evidence in records you can check.|steps',
          '来源|方法|问问来源和方法，判断依据来自哪里。|source|method|Ask about the source and the method.|steps',
          '承认|未知|承认未知，是给后续核查留下位置。|unknown|check|An unknown leaves something to check later.|summary',
        ],
      ],
      [
        '区分必要和足够',
        'Necessary is not the same as enough',
        [
          '必要|条件|必要条件是缺少它就无法满足的条件。|necessary|condition|A necessary condition cannot be missing.|definition',
          '电源|电脑|电脑运行需要电源，但只有电源还不够。|power|computer|A computer needs power, but power alone is not enough.|example',
          '足够|结果|足够条件则要能保证所讨论的结果。|enough|result|If conditions are enough, they secure the stated result.|contrast',
          '判断|措辞|判断一句话时，检查它用了哪种措辞。|wording|claim|Check which wording a claim actually uses.|summary',
        ],
      ],
    ],
  ],
  [
    'digital',
    '数字素养',
    'Digital literacy',
    [
      [
        '先看网址再点击',
        'Look at the address before opening',
        [
          '链接|地址|点击链接前，先看清实际地址。|link|address|Before opening a link, inspect its address.|steps',
          '域名|拼写|熟悉的图标，不代表域名拼写正确。|domain|spelling|A familiar icon does not confirm domain spelling.|contrast',
          '核对|入口|有疑问时，从已知入口另行核对。|check|known route|If unsure, check through a known route.|steps',
          '外观|身份|页面外观相似，不足以证明身份。|appearance|identity|Similar appearance does not establish identity.|summary',
        ],
      ],
      [
        '副本不等于备份完成',
        'A copy is not the whole backup plan',
        [
          '备份|副本|备份先要有原文件之外的副本。|backup|copy|A backup starts with a copy beyond the original.|definition',
          '硬盘|两份|两份都在同一硬盘，仍共享一些风险。|drive|copies|Two copies on one drive still share some risks.|example',
          '恢复|检查|试着恢复一个小文件，检查能否读取。|restore|file|Try to restore a small file and open it.|steps',
          '更新|变化|原文件变化后，也要考虑副本如何更新。|update|original|Plan how to update the copy when the original changes.|summary',
        ],
      ],
      [
        '搜索结果也要看来源',
        'Search results still need a source check',
        [
          '搜索|线索|搜索结果提供线索，不自动保证正确。|search|clues|A search provides clues, not a guarantee of truth.|fact',
          '日期|版本|查看日期，判断内容对应哪个版本。|date|version|Check the date and the version being discussed.|steps',
          '来源|原文|能找到来源时，尽量查看原文。|source|original|When possible, inspect the original source.|steps',
          '摘录|上下文|简短摘录可能省略重要上下文。|snippet|context|A short snippet may omit important context.|summary',
        ],
      ],
      [
        '像素与显示尺寸',
        'Pixels and display size',
        [
          '像素|网格|数字图像可以由像素组成规则网格。|pixels|grid|A digital image can be a grid of pixels.|definition',
          '放大|方块|把小图放大，可能看到方块边缘。|enlarge|blocks|If you enlarge a small image, blocks may appear.|example',
          '数量|尺寸|像素数量，不单独决定实际显示尺寸。|count|size|Pixel count alone does not set physical size.|contrast',
          '用途|清晰|按用途查看图像是否足够清晰。|use|clarity|Judge clarity at the size and use you need.|summary',
        ],
      ],
      [
        '文件扩展名的线索',
        'What a file extension tells you',
        [
          '扩展名|格式|文件扩展名通常提示预期格式。|extension|format|A file extension suggests an expected format.|definition',
          '改名|内容|把图片改名为文本，不会改变内部内容。|rename|contents|To rename an image does not change its contents.|example',
          '打开|程序|打开文件还要依赖能读取它的程序。|program|read|A program must be able to read the actual format.|fact',
          '确认|来源|遇到意外文件，先确认来源和类型。|source|type|For an unexpected file, check its source and type.|summary',
        ],
      ],
      [
        '权限和当前任务',
        'Match a permission to the task',
        [
          '权限|任务|查看权限请求是否符合当前任务。|permission|task|Check whether a permission fits the current task.|steps',
          '手电筒|通讯录|只开手电筒，为什么要读通讯录？|torch|contacts|Why would a torch need access to contacts?|example',
          '拒绝|说明|不明白时，可以先拒绝并查看说明。|decline|explanation|You can decline and look for an explanation.|steps',
          '需要|全部|某项功能需要权限，不表示需要全部权限。|access|everything|One access need does not mean access to everything.|summary',
        ],
      ],
      [
        '表格每列一种含义',
        'Give each column one meaning',
        [
          '列名|含义|列名写清这一列记录的含义。|column|meaning|Give each column a clear meaning.|steps',
          '单位|厘米|长度列若用厘米，就在标题注明单位。|units|cm|For a length column in cm, label the units.|example',
          '混合|排序|混合文字和数字，可能让排序难以理解。|mixed|sort|A mixed text and number column can confuse a sort.|contrast',
          '空白|未知|也约定空白表示未知，还是不适用。|blank|unknown|Agree whether a blank means unknown or not applicable.|summary',
        ],
      ],
      [
        '版本历史能回答什么',
        'What version history can answer',
        [
          '历史|变化|版本历史记录文件随时间的变化。|history|changes|Version history records changes over time.|definition',
          '比较|两版|比较两版，可以看到段落被怎样修改。|compare|versions|You can compare two versions to inspect a paragraph edit.|example',
          '恢复|旧版|恢复旧版前，先保留当前有用的改动。|restore|edits|Before a restore, keep useful current edits.|steps',
          '记录|原因|加一句修改原因，让记录更容易理解。|reason|record|Add a reason so the record makes more sense.|summary',
        ],
      ],
      [
        '压缩会舍掉什么',
        'What compression can leave out',
        [
          '压缩|体积|压缩的一个目标是减小文件体积。|compression|size|Data compression can reduce file size.|definition',
          '无损|还原|无损压缩允许精确还原原始数据。|lossless|restore|A lossless format can restore the original data.|fact',
          '有损|细节|有损压缩可能舍掉部分图像或声音细节。|lossy|detail|A lossy format can discard image or sound detail.|contrast',
          '比较|用途|比较压缩前后，再按用途选择。|compare|purpose|You can compare the result for your actual purpose.|summary',
        ],
      ],
      [
        '把自动生成当作待核草稿',
        'Treat generated output as a draft to check',
        [
          '草稿|核对|把自动生成的回答当作待核对草稿。|draft|check|Treat generated output as a draft to check.|steps',
          '流畅|正确|文字流畅，不表示事实一定正确。|fluent|correct|A fluent reply does not make a claim correct.|contrast',
          '引用|存在|遇到引用，检查来源是否真的存在。|citation|source|For a citation, check that the source exists.|steps',
          '隐私|材料|输入材料前，考虑隐私，检查私人信息。|privacy|input|Consider privacy before sharing an input.|summary',
        ],
      ],
    ],
  ],
  [
    'science',
    '基础科学',
    'Basic science',
    [
      [
        '影子为什么变长',
        'Why a shadow changes length',
        [
          '影子|遮挡|影子出现在光被物体遮挡的区域。|shadow|light|A shadow appears where an object blocks light.|definition',
          '低角度|拉长|光以低角度照来，影子往往被拉长。|low angle|longer|Light from a low angle often casts a longer shadow.|example',
          '位置|光源|移动光源位置，也会改变影子的方向。|source|direction|Moving the light source changes shadow direction.|fact',
          '比较|物体|比较时先固定物体，只改变光源位置。|compare|object|To compare, hold the object still and move the light.|steps',
        ],
      ],
      [
        '声音需要什么经过',
        'What sound travels through',
        [
          '声音|振动|声音与物体振动及其传播有关。|sound|vibration|A sound involves vibration travelling through matter.|definition',
          '空气|耳朵|说话时，空气把振动传向耳朵。|air|ears|When someone speaks, air carries vibration to ears.|example',
          '真空|介质|理想真空没有传播普通声波的介质。|vacuum|medium|A vacuum lacks a medium for ordinary sound waves.|contrast',
          '光线|不同|光线可以穿过真空，这点与声音不同。|light|sound|Visible light can cross a vacuum; sound cannot.|summary',
        ],
      ],
      [
        '金属为何摸着更凉',
        'Why metal can feel cooler',
        [
          '温度|感觉|相同温度的物体，触摸感觉可能不同。|temperature|feel|Objects at one temperature can feel different.|fact',
          '金属|木头|室内的金属，可能比旁边木头显得更凉。|metal|wood|Indoor metal may feel cooler than nearby wood.|example',
          '热量|较快|金属通常把手上的热量传走得较快。|heat|faster|Metal often carries heat away from a hand faster.|fact',
          '测量|触感|要比较温度，应测量而不只凭触感。|measure|touch|To compare temperature, measure rather than just touch.|summary',
        ],
      ],
      [
        '看水慢慢离开杯子',
        'Watch water leave a cup',
        [
          '蒸发|表面|蒸发发生在液体表面。|evaporation|surface|During evaporation, liquid leaves its surface as vapor.|definition',
          '水位|标线|给敞口杯画标线，之后观察水位。|water level|mark|Put a mark on a cup; later check its water level.|example',
          '条件|空气|温度、空气流动等条件会影响蒸发。|airflow|rate|Temperature and airflow affect the rate.|fact',
          '比较|杯子|比较时用相同杯子，只改一个条件。|compare|cups|To compare, use matching cups and change one factor.|steps',
        ],
      ],
      [
        '力不只是让物体快起来',
        'A force can do more than speed things up',
        [
          '力|运动|合力可以改变物体的运动状态。|force|motion|A net force can change an object’s motion.|definition',
          '推力|小车|推小车时，推力会影响速度的变化。|push|cart|A push on a cart can change its speed.|example',
          '方向|转弯|转弯改变运动方向，也是一种运动变化。|direction|turn|A turn changes the direction of motion.|fact',
          '形变|弹簧|力还可以让弹簧等物体发生形变。|spring|shape|A force can also change a spring’s shape.|summary',
        ],
      ],
      [
        '同样体积不一定同样重',
        'Equal volume need not mean equal mass',
        [
          '密度|体积|密度是质量与体积的比值。|density|volume|The density is mass divided by volume.|definition',
          '同体积|质量|同体积的不同材料，质量可能不同。|equal volume|mass|Materials of equal volume can differ in mass.|example',
          '空隙|整体|材料内部的空隙，也会影响整体比较。|gaps|comparison|Internal gaps can matter in the comparison.|fact',
          '单位|比值|计算比值时，分别统一质量单位与体积单位。|units|ratio|For the ratio, use consistent units for each quantity.|steps',
        ],
      ],
      [
        '反射里的入射与出射',
        'Light arriving and reflecting',
        [
          '反射|表面|光遇到表面时，可以发生反射。|reflection|surface|Light can undergo reflection at a surface.|definition',
          '镜面|方向|光滑镜面会把入射光反射到特定方向。|mirror|direction|A smooth mirror reflects light in a clear direction.|example',
          '粗糙|散开|粗糙表面会让反射光向许多方向散开。|rough|scatter|A rough surface can scatter reflected light.|contrast',
          '看见|光|我们看见物体，需要光进入眼睛。|see|eyes|To see an object, light must enter our eyes.|summary',
        ],
      ],
      [
        '斜坡为什么能绕远路',
        'A ramp trades distance for force',
        [
          '斜坡|高度|斜坡让物体沿较长路径升到一定高度。|ramp|height|A ramp gives a longer route to a height.|definition',
          '路径|推力|理想情况下，较长路径可减少所需推力。|distance|force|Ideally, more distance can mean less pushing force.|fact',
          '摩擦|实际|实际斜坡还要考虑摩擦等因素。|friction|real ramp|A real ramp also involves friction.|contrast',
          '能量|免费|省力不表示能量是免费得到的。|energy|free|Less force does not mean free energy.|summary',
        ],
      ],
      [
        '为什么量三次',
        'Why take three measurements',
        [
          '测量|误差|测量结果可能带有误差。|measurement|error|A measurement can contain error.|fact',
          '尺子|起点|尺子起点没对齐，会影响读数。|ruler|start|A ruler’s start position affects the reading.|example',
          '重复|差异|重复测量，可以观察结果之间的差异。|repeat|variation|You can repeat a measurement to inspect variation.|steps',
          '偏差|修正|重复不会自动修正总是用错起点的偏差。|bias|repeats|The same wrong start can bias all the repeats.|contrast',
        ],
      ],
      [
        '热气球与周围空气',
        'Warm air and a balloon',
        [
          '空气|受热|空气受热后，在一定条件下会膨胀。|air|warms|The air can expand as it warms.|fact',
          '密度|周围|气球内空气的密度可低于周围空气。|density|balloon|Air density inside a balloon can be lower.|example',
          '浮力|重量|当浮力足以超过总重量，气球能够上升。|buoyancy|weight|A balloon rises when buoyancy exceeds its total weight.|fact',
          '条件|载荷|载荷与环境等条件也影响能否升起。|load|conditions|The load and other conditions also matter.|summary',
        ],
      ],
    ],
  ],
  [
    'design',
    '设计观察',
    'Observing design',
    [
      [
        '留白也在分组',
        'Empty space can group things',
        [
          '留白|分组|留白可以帮助看出信息如何分组。|space|groups|Empty space can help reveal information groups.|fact',
          '距离|标签|标签与项目的距离，会影响它看起来属于谁。|distance|label|The distance from a label can suggest what it names.|example',
          '比较|间距|比较两版页面，只改变一处间距。|compare|gap|You can compare two layouts by changing one gap.|steps',
          '清楚|空白|空白不是越多越好，要看关系是否清楚。|clear|space|More space is not always better; keep relations clear.|summary',
        ],
      ],
      [
        '重要信息先看到',
        'Make the first thing worth seeing',
        [
          '层级|顺序|视觉层级安排人先看到什么顺序。|hierarchy|order|Visual hierarchy suggests an order of attention.|definition',
          '标题|大小|标题的大小，可以提示这页的主题。|title|size|A title with a larger size can signal the topic.|example',
          '争抢|重点|所有字都放大时，它们会争抢重点。|large|compete|If all words are large, they compete for attention.|contrast',
          '检查|视线|眯眼检查一下，视线是否落在预期位置。|check|focus|Squint briefly to check the visual focus.|steps',
        ],
      ],
      [
        '对齐让边界说话',
        'Let alignment make an edge clear',
        [
          '对齐|边界|对齐可以形成清楚的视觉边界。|alignment|edge|Consistent alignment can create a clear visual edge.|definition',
          '菜单|起点|菜单文字共用起点，比较时少一些跳动。|menu|start|Give menu items a shared start position.|example',
          '刻意|例外|需要例外时，让偏离成为刻意选择。|exception|intent|Make an exception a choice with intent.|contrast',
          '检查|细线|临时画条细线，检查左右是否对齐。|guide|check|Use a temporary guide to check the edges.|steps',
        ],
      ],
      [
        '按钮要像能做的事',
        'A button should name its action',
        [
          '按钮|动作|按钮文字最好说明点击后的动作。|button|action|Let a button name the action it performs.|steps',
          '保存|下载|“保存设置”和“下载文件”指不同结果。|save|download|A save action and a download have different results.|contrast',
          '反馈|完成|点击后给出反馈，说明是否已经完成。|feedback|done|After a click, feedback can say whether it is done.|steps',
          '一致|名称|同一个动作，在不同地方保持名称一致。|name|consistent|Keep the name of the same action consistent.|summary',
        ],
      ],
      [
        '图标旁边的几个字',
        'A few words beside an icon',
        [
          '图标|理解|一个图标不一定人人都能理解。|icon|meaning|An icon’s meaning may not be clear to everyone.|fact',
          '星形|收藏|星形可能表示收藏，也可能表示评分。|star|rating|A star may mean a bookmark or a rating.|example',
          '文字|标签|加一个简短文字标签，可以说明用途。|label|purpose|A short label can explain its purpose.|steps',
          '测试|陌生人|让陌生人测试并说明图标含义，不只问好不好看。|test|explain|In a test, ask someone new to explain the icon.|summary',
        ],
      ],
      [
        '动画如何让人知道发生什么',
        'Motion can explain a change',
        [
          '动画|变化|动画可以提示界面发生了什么变化。|motion|change|Some motion can indicate a change in an interface.|fact',
          '抽屉|侧边|抽屉从侧边展开，让人知道内容来自哪里。|drawer|side|A drawer opening from the side shows where it came from.|example',
          '等待|装饰|只有装饰而增加等待时，应检查是否值得。|delay|decoration|Question a delay that adds only decoration.|contrast',
          '减少|选择|也给不喜欢动态效果的人减少动作的选择。|reduce|choice|Offer a choice to reduce motion.|summary',
        ],
      ],
      [
        '窄屏不是缩小的大屏',
        'A narrow screen needs its own space',
        [
          '窄屏|空间|窄屏能用的空间，与桌面不同。|narrow|space|A narrow screen has different usable space.|fact',
          '并排|上下|原先并排的两栏，可以改成上下排列。|columns|stack|Two columns can stack on a small screen.|example',
          '点击|间隔|让点击目标之间保留足够间隔。|targets|gap|Leave a usable gap between touch targets.|steps',
          '实测|横向|用真实窄屏实测，检查是否横向溢出。|test|overflow|You can test a narrow view for horizontal overflow.|summary',
        ],
      ],
      [
        '黑白也能有重点',
        'Emphasis without adding color',
        [
          '黑白|重点|黑白界面也可以区分信息重点。|black|white|In black and white, visual priority still matters.|fact',
          '大小|粗细|用大小、粗细和位置建立差别。|size|weight|Use size, weight and position to create differences.|steps',
          '灰色|对比|灰色文字太淡时，对比可能不足。|gray|contrast|Very faint gray text can have too little contrast.|contrast',
          '阅读|装饰|先保证能阅读，再考虑装饰的精细程度。|read|decoration|Make it possible to read before refining decoration.|summary',
        ],
      ],
      [
        '空状态要给下一步',
        'An empty view needs a next step',
        [
          '空状态|内容|空状态表示这里还没有可显示的内容。|empty|content|An empty view has no content to show yet.|definition',
          '相册|照片|空相册可以说明：先选择一张照片。|album|photo|An empty album can ask you to choose a photo.|example',
          '按钮|入口|把所需按钮放在说明旁，给出入口。|button|message|Place the needed button beside the message.|steps',
          '故障|区别|没有内容与加载故障，要让人看得出区别。|missing|failed|Keep missing content distinct from a failed load.|summary',
        ],
      ],
      [
        '错误提示指向修复',
        'An error message should point to a fix',
        [
          '错误|原因|错误提示说清已知原因，不猜测未知部分。|error|known cause|State an error’s known cause without guessing.|steps',
          '格式|文件|“文件格式不支持”比“出错了”具体。|format|file|An unsupported file format is a specific problem.|example',
          '重试|步骤|告诉用户可以重试，还是需要换个步骤。|retry|step|Say whether to retry or try a different step.|steps',
          '材料|保留|失败后尽量保留已经输入的材料。|keep|input|After a failure, keep the user’s input when possible.|summary',
        ],
      ],
    ],
  ],
  [
    'creation',
    '创作实践',
    'Creative practice',
    [
      [
        '给草稿一个小范围',
        'Give a draft a small scope',
        [
          '草稿|范围|第一份草稿先限定一个小范围。|draft|scope|Give the first draft a small scope.|steps',
          '场景|一分钟|先写一分钟场景，而不是整部长片。|scene|minute|Write a one-minute scene before a whole film.|example',
          '问题|具体|做完后，才有一份具体作品可以提问题。|work|questions|Finished work gives you something to ask questions of.|fact',
          '扩展|需要|下一轮按需要扩展，而非一次塞满。|expand|need|In the next pass, expand only where there is a need.|summary',
        ],
      ],
      [
        '同题做三个变体',
        'Try three versions of one idea',
        [
          '变体|同题|针对同题，先做几个不同变体。|versions|idea|Try several versions of one idea.|steps',
          '海报|标题|同一张海报，分别把标题放上、中、下。|poster|title|On a poster, try the title at three positions.|example',
          '比较|差别|并排比较，说明每版带来什么差别。|compare|difference|You can compare them and describe the difference.|steps',
          '保留|理由|选一版保留，同时记下选择理由。|keep|reason|You can keep one version and note the reason.|summary',
        ],
      ],
      [
        '限制也能成为题目',
        'Let a constraint become the prompt',
        [
          '限制|选择|限制可以缩小创作时面对的选择。|constraint|choices|A constraint can narrow your creative choices.|fact',
          '三个字|画面|只用三个字，试着做一张完整画面。|three words|image|Try making an image with only three words.|example',
          '组合|位置|改变位置和组合，而不是添加更多元素。|position|arrange|Change position and arrange what is already there.|steps',
          '放开|目的|练习后再按目的决定是否放开限制。|relax|purpose|Then decide whether to relax the limit for your purpose.|summary',
        ],
      ],
      [
        '素材簿要能找回来',
        'Make a reference notebook searchable',
        [
          '素材|出处|收集素材时，同时记录出处。|reference|source|Keep the source with a collected reference.|steps',
          '标签|用途|标签写用途，例如“柔和转场”。|tag|transition|A tag such as gentle transition names a use.|example',
          '许可|灵感|欣赏灵感，不等于取得复制素材的许可。|inspiration|permission|Finding inspiration does not grant permission to copy.|contrast',
          '整理|找回|定期整理，看看还能否找回需要的条目。|organize|find|You can organize the notes so you can find them again.|summary',
        ],
      ],
      [
        '先做纸上模型',
        'Try a model on paper',
        [
          '模型|问题|简单模型先回答一个小问题。|model|question|Let a small model answer one question.|steps',
          '纸片|菜单|用纸片摆菜单，试试能否找到退出。|paper|menu|A paper menu can test whether Exit is easy to find.|example',
          '细节|暂缓|暂缓精细细节，把注意放在流程上。|details|flow|Set details aside while checking the flow.|steps',
          '反馈|调整|根据实际反馈，再调整模型。|feedback|revise|Use actual feedback to revise the model.|summary',
        ],
      ],
      [
        '剪辑看前后关系',
        'An edit joins two moments',
        [
          '剪辑|关系|剪辑不只是删片段，也在建立前后关系。|edit|relation|An edit builds a relation between two moments.|definition',
          '空椅子|离开|人物离开后切空椅子，会留下不同感觉。|empty chair|leaves|An empty chair after someone leaves changes the scene.|example',
          '顺序|解释|交换顺序，再看观众会如何解释。|order|meaning|Swap the order and consider the change in meaning.|steps',
          '核对|原意|用真实记录时，核对是否改变了原意。|check|context|For real footage, check that the context stays intact.|summary',
        ],
      ],
      [
        '修订先动一个变量',
        'Revise one variable first',
        [
          '变量|修改|一次先选一个变量来修改。|variable|change|Choose one variable to change first.|steps',
          '音量|配乐|改配乐音量时，先不同时改画面速度。|volume|speed|When changing volume, keep the image speed fixed.|example',
          '对照|影响|留下对照版本，比较这次修改的影响。|compare|version|Keep a version to compare with the new edit.|steps',
          '组合|理解|理解各自影响后，再考虑组合修改。|combine|effects|After checking each, combine effects if useful.|summary',
        ],
      ],
      [
        '收集能回答的问题',
        'Ask for feedback you can use',
        [
          '提问|具体|给看作品的人一个具体提问。|question|specific|Give the viewer one specific question.|steps',
          '开头|人物|例如：看到开头，你知道人物要去哪吗？|opening|person|From the opening, where is the person trying to go?|example',
          '观察|解释|先听观察，再解释自己的创作意图。|observe|explain|Let them observe before you explain your intent.|steps',
          '修改|目的|按作品目的判断哪些反馈值得修改。|purpose|feedback|Use the purpose to decide which feedback to act on.|summary',
        ],
      ],
      [
        '保存被放弃的想法',
        'Keep an idea you set aside',
        [
          '放弃|删除|暂时放弃，不一定要立刻删除。|aside|delete|To set an idea aside need not mean delete it.|contrast',
          '草图|文件夹|把不用的草图放进单独文件夹。|sketch|folder|Put the unused sketch in a separate folder.|example',
          '备注|原因|留一句备注，说明没选它的原因。|note|reason|Leave a note with the reason it was not chosen.|steps',
          '重看|条件|以后条件不同，可以重看而不是照搬。|revisit|conditions|Under new conditions, revisit it rather than copy it.|summary',
        ],
      ],
      [
        '结束也要有标准',
        'Give a project a stopping point',
        [
          '结束|标准|开始创作前，也写一个结束标准。|stop|criterion|Before creating, choose a criterion for when to stop.|steps',
          '短片|三点|短片这轮只核对声音、字幕和三点剧情。|clip|sound|For this clip, check sound, text and three plot points.|example',
          '新点子|下一轮|核对时冒出的新点子，可以留给下一轮。|new ideas|pass|Keep new ideas for another pass.|steps',
          '交付|记录|完成这轮交付，记录仍然存在的限制。|deliver|limits|When you deliver, record the remaining limits.|summary',
        ],
      ],
    ],
  ],
  [
    'tasks',
    '时间任务',
    'Time and tasks',
    [
      [
        '倒推一次出门',
        'Plan backward from leaving',
        [
          '出门|装好包|八点出门，七点五十先装好包。|Leave|bag|Leave at eight; pack the bag at seven fifty.|example',
          '钥匙|门边|早餐前，把钥匙放在门边。|Keys|door|Keys go beside the door before breakfast.|steps',
          '最后|检查|最后十分钟留给穿鞋和检查。|last|checks|The last ten minutes belong to shoes and checks.|steps',
          '下雨|提前|下雨要加外套，就把装包稍微提前。|Rain|earlier|Rain adds a coat, so move packing a little earlier.|summary',
        ],
      ],
      [
        '烧水的两分钟',
        'Two minutes before tea',
        [
          '水壶|计时器|水壶的计时器还剩两分钟。|kettle|timer|The kettle has two minutes left on its timer.|example',
          '便签|待办|在冰箱旁的便签上写一件待办。|note|errand|Write one errand on the note by the fridge.|steps',
          '水槽|间隙|清理水槽留给更长的休息间隙。|sink|break|Keep the sink task for a longer break.|contrast',
          '计时|泡茶|计时结束，就回来继续泡茶。|timer|tea|When the timer ends, return to making tea.|summary',
        ],
      ],
      [
        '两场会议之间',
        'Between two meetings',
        [
          '会议|开始|前一场会议十点结束，下一场十点十分开始。|meeting|starts|One meeting ends at ten; the next starts ten past ten.|example',
          '空档|决定|这段空档先用来写下一个决定。|gap|decision|Use the gap to write down one decision.|steps',
          '一行|处理|另起一行，记清是谁接着处理。|line|handles|Add a line naming who handles the next step.|steps',
          '剩下|走动|剩下的几分钟，留给喝水和走动。|remaining|walk|Leave the remaining minutes for water and a walk.|summary',
        ],
      ],
      [
        '临时来的小请求',
        'A request arrives mid-task',
        [
          '请求|报告|正写报告时，同事发来一个小请求。|request|report|A colleague sends a request as you write a report.|example',
          '截止时间|消息|先问清截止时间，不只看消息有多新。|deadline|message|Ask about the deadline, not just the message time.|steps',
          '下午|清单|若能等到下午，就记进下午清单。|afternoon|list|If it can wait, put it on the afternoon list.|steps',
          '现在|报告|确实要现在处理，就标出报告停在哪。|now|report|If it needs action now, mark your place in the report.|summary',
        ],
      ],
      [
        '洗衣任务的交接点',
        'Handing off the laundry',
        [
          '洗衣|下一步|洗衣程序六点结束，晾衣是下一步。|wash|next step|The wash ends at six; hanging it is the next step.|example',
          '提醒|晾衣服|提醒写成晾衣服，而不是只写洗衣。|reminder|hang laundry|Call the reminder hang laundry, rather than wash.|steps',
          '衣架|篮子|出门前，先把衣架放到篮子旁。|hangers|basket|Before leaving, put the hangers beside the basket.|steps',
          '不在家|时间|如果六点不在家，就重新安排交接时间。|out|time|If you will be out at six, choose another handoff time.|summary',
        ],
      ],
      [
        '关文件前留一句',
        'Before closing the file',
        [
          '标题|保存|图表还差一个标题，先把文件保存。|title|save|The chart needs a title; save the file first.|example',
          '备注|下一步|留一句备注：下一步补上标题。|note|next step|Leave a note: add the title as the next step.|steps',
          '文件名|表格|把相关表格的文件名也写进去。|filename|table|Include the filename of the related table.|steps',
          '明天|备注|明天打开时，先看这条备注再继续。|Tomorrow|note|Tomorrow, read that note before continuing.|summary',
        ],
      ],
      [
        '一趟出门的顺路清单',
        'One trip, several stops',
        [
          '包裹|还书|今天要寄包裹，还要去图书馆还书。|parcel|return|Send a parcel and return library books today.|example',
          '地图|顺序|在地图上标出两个地点，看看先后顺序。|map|order|Mark both places on a map and compare the order.|steps',
          '分开放|翻找|包裹和书分开放，取用时不用一起翻找。|separately|find|Pack them separately so each is easier to find.|steps',
          '办完|划掉|某一站办完，就划掉那一项。|stop|cross|After each stop, cross that item off the list.|summary',
        ],
      ],
      [
        '给一次搜索画边界',
        'A boundary for one search',
        [
          '说明书|清洗|这次只找咖啡机说明书里的清洗步骤。|manual|cleaning|Find the cleaning steps in the coffee machine manual.|example',
          '问题|搜索|先写好问题，再打开搜索页面。|question|search|Write the question before opening the search page.|steps',
          '页码|比较|把找到的页码记下，不顺手扩成选购比较。|page number|comparisons|Note the page number; leave buying comparisons aside.|contrast',
          '缺口|来源|找不到就标记缺口，稍后换一个来源。|gap|source|If it is missing, mark the gap and try another source.|summary',
        ],
      ],
      [
        '开工前的一张桌面',
        'A desk before starting',
        [
          '草图|三张|今天先处理退回来的三张草图。|sketches|three|Start today with the three sketches sent back.|example',
          '桌面|一支笔|桌面上只摆这三张和一支笔。|desk|pen|Put only those sheets and a pen on the desk.|steps',
          '盒子|稍后|其他材料装进盒子，标签写稍后。|Box|later|Box the other materials and label them later.|steps',
          '第一张|下一张|完成第一张后，再决定是否展开下一张。|one|next|Finish one sketch, then decide whether to open the next.|summary',
        ],
      ],
      [
        '周末整理一小批照片',
        'Sorting one small photo batch',
        [
          '散步|照片|这次只整理上周散步拍的照片。|walk|photos|Sort only the photos from last week’s walk.|example',
          '模糊|相似|先删明显模糊的，再看相似画面。|blurs|similar|Remove clear blurs first, then compare similar shots.|steps',
          '一张|待选|两张很像时，暂留一张进待选文件夹。|one|maybe|For two close shots, put one in a maybe folder.|steps',
          '这一批|旧相册|这一批结束就停下，不临时翻旧相册。|batch|albums|Stop after this batch rather than opening old albums.|summary',
        ],
      ],
    ],
  ],
  [
    'everyday',
    '日常观察',
    'Everyday observation',
    [
      [
        '窗影经过桌面',
        'A window shadow on the desk',
        [
          '窗影|笔记本|九点，窗影横过桌上的笔记本。|shadow|notebook|At nine, the window shadow crosses the notebook.|example',
          '边缘|空白处|十点，影子的边缘移到桌面空白处。|edge|empty part|At ten, its edge reaches the empty part of the desk.|fact',
          '废纸|边线|在一张废纸上标出两次影子的边线。|paper|edges|Mark both edges on a scrap of paper.|steps',
          '标记|时刻|这些标记把同一地点的两个时刻放在一起。|marks|moments|The marks let you compare two moments in one place.|summary',
        ],
      ],
      [
        '杯子外侧的水珠',
        'Drops outside a glass',
        [
          '冷杯|常温杯|把冷杯和常温杯并排放好。|cold|room|Put a cold glass and a room-temperature glass side by side.|steps',
          '外侧|几滴水|冷杯的外侧出现了几滴水。|outside|drops|A few drops appear on the outside of the cold glass.|fact',
          '擦干|位置|擦干一小块，再观察同一个位置。|Wipe|area|Wipe one patch and watch that same area again.|steps',
          '记录|印象|记录眼前所见，不只凭印象猜测。|Record|memory|Record what you see, rather than guessing from memory.|summary',
        ],
      ],
      [
        '水洼里的路牌',
        'A sign in a puddle',
        [
          '路牌|水洼|路牌倒着映在水洼里。|sign|puddle|A street sign appears upside down in the puddle.|example',
          '涟漪|倒影|鞋子经过，涟漪穿过那片倒影。|ripples|reflection|A passing shoe sends ripples through its reflection.|fact',
          '水面|字母|水面平静后，字母又显出来。|surface|letters|When the surface settles, the letters appear again.|fact',
          '画下|路牌|分别画下有涟漪和没涟漪的路牌。|Sketch|sign|Sketch the sign once with ripples and once without.|steps',
        ],
      ],
      [
        '两片面包的切面',
        'Two slices, two patterns',
        [
          '面包|孔洞|一片面包孔洞大，另一片孔洞小。|slice|holes|One slice has large holes; the next has smaller ones.|example',
          '切面|外皮|看切面，而不只是看外皮。|faces|crust|Look at the cut faces, rather than only the crust.|contrast',
          '并排|光线|把两片并排放在同样的光线下。|side by side|light|Set the slices side by side under the same light.|steps',
          '描述|好看|先描述孔洞，再决定哪片更好看。|Describe|nicer|Describe the holes before deciding which looks nicer.|summary',
        ],
      ],
      [
        '靠近一块招牌',
        'Approaching a shop sign',
        [
          '街角|招牌|从街角看，招牌像一整块深色。|corner|sign|From the corner, the shop sign looks like a dark block.|example',
          '走近|字母|走近后，一个个字母容易分开看清。|Closer|letters|Closer up, separate letters become easy to see.|fact',
          '位置|清楚|在两个位置站定，记下哪些字仍清楚。|spots|clear|Stand at two spots and note which words remain clear.|steps',
          '距离|细节|距离改变了能分辨出的细节。|Distance|detail|Distance changes what detail you can pick out.|summary',
        ],
      ],
      [
        '两片叶子的轮廓',
        'Two leaf outlines',
        [
          '叶子|轮廓|这株植物的两片叶子，轮廓并不一样。|leaves|outlines|Two leaves on this plant have different outlines.|example',
          '白纸|叶子|在每片叶子后放一张白纸。|paper|leaves|Put white paper behind each of the leaves.|steps',
          '长边|短弧|先描长边，再描叶柄附近的短弧。|long edge|short curve|Trace the long edge, then the short curve near the stem.|steps',
          '草图|一片叶|保留两张草图，不把它们平均成一片叶。|sketches|one leaf|Keep both sketches; do not average them into one leaf.|summary',
        ],
      ],
      [
        '不一样的蓝色书脊',
        'Different blues on a shelf',
        [
          '蓝色|书脊|远看，三本书的蓝色书脊很相似。|blue|spines|Three blue book spines look similar from far away.|example',
          '灰蓝|偏绿|近看，一本偏灰蓝，另一本偏绿。|grey-blue|green|Up close, one is grey-blue and another leans green.|contrast',
          '白卡|比较|把它们放在同一张白卡旁比较。|card|Compare|Compare them beside the same white card.|steps',
          '差别|蓝色|说出看到的差别，不只说都是蓝色。|difference|blue|Name the difference you see, not just blue.|summary',
        ],
      ],
      [
        '纸条上的折痕',
        'Creases on a paper strip',
        [
          '纸条|对折|把纸条对折，再重新打开。|paper strip|Fold|Fold a paper strip in half and reopen it.|steps',
          '折痕|两部分|折痕把纸条分成了两部分。|crease|two parts|The crease splits the strip into two parts.|fact',
          '一端|折痕|把一端对齐折痕，再折一次。|end|crease|Match one end to the crease and fold again.|steps',
          '展开|间距|展开后，比较几条线之间的间距。|Unfold|spaces|Unfold it and compare the spaces between the lines.|summary',
        ],
      ],
      [
        '键盘表面的痕迹',
        'Marks on a keyboard',
        [
          '空格键|亮面|空格键的一侧有一小块亮面。|space bar|shiny|The space bar has a shiny patch near one edge.|example',
          '没用过|哑光|旁边没用过的键，表面仍均匀哑光。|unused|matte|An unused key beside it still looks evenly matte.|contrast',
          '台灯|反光|移动台灯，别让反光遮住其中一块表面。|lamp|glare|Move the lamp so its glare does not hide either surface.|steps',
          '表面|猜测|描述表面，不据此猜测是谁用过。|surfaces|guessing|Describe the surfaces without guessing who used them.|summary',
        ],
      ],
      [
        '便签翘起的一角',
        'A lifted corner of a note',
        [
          '胶带|便签|一条胶带把便签固定在墙上。|tape|note|A strip of tape holds a note on the wall.|example',
          '翘起来|中间|一个角翘起来，中间仍然平贴。|curls|middle|One corner curls while the middle stays flat.|fact',
          '侧面|缝隙|从侧面看，能看到角下面的缝隙。|side|gap|Look from the side to see the gap under the corner.|steps',
          '形状|压平|先画下形状，再把它压平。|shape|flat|Draw its shape before pressing it flat again.|summary',
        ],
      ],
    ],
  ],
];

const relationTypes = {
  opening: 'direction',
  definition: 'related',
  example: 'expand',
  steps: 'method',
  contrast: 'contrast',
  fact: 'context',
  summary: 'combine',
};
const unpack = (row) => {
  const [primaryZh, secondaryZh, zh, primaryEn, secondaryEn, en, sentenceType] = row.split('|');
  return { primaryZh, secondaryZh, zh, primaryEn, secondaryEn, en, sentenceType };
};

function makeTopic(group, topic, index, english) {
  const [categoryId, categoryZh, categoryEn] = group;
  const [titleZh, titleEn, rows] = topic;
  const id = `extended-${categoryId}-${String(index + 1).padStart(2, '0')}`;
  const entries = rows.map(unpack);
  const lines = entries.map((row, lineIndex) => {
    const text = english ? row.en : row.zh;
    const keyword = english ? row.primaryEn : row.primaryZh;
    const secondary = english ? row.secondaryEn : row.secondaryZh;
    const previous = entries[lineIndex - 1];
    const incoming =
      previous && previous.primaryZh !== row.primaryZh
        ? {
            relation: {
              from: english ? previous.primaryEn : previous.primaryZh,
              to: keyword,
              type: 'progress',
              label: english
                ? `From ${previous.primaryEn}, consider ${keyword}`
                : `从${previous.primaryZh}接着看${keyword}`,
            },
          }
        : {};
    return {
      id: `${id}-${lineIndex + 1}`,
      text,
      keyword,
      keywords: [
        { text: keyword, role: 'primary', ...incoming },
        {
          text: secondary,
          role: 'secondary',
          relation: { from: keyword, to: secondary, type: relationTypes[row.sentenceType], label: text },
        },
      ],
      sentenceType: row.sentenceType,
      holdBeats: row.en.length > 44 ? 12 : 8,
    };
  });
  return {
    schemaVersion: 1,
    sourceMode: 'source-only',
    id,
    title: english ? titleEn : titleZh,
    keyword: lines[0].keyword,
    emoji: '',
    categoryId,
    category: english ? categoryEn : categoryZh,
    relations: lines.flatMap((line) =>
      line.keywords.flatMap((entry) => (entry.relation ? [{ ...entry.relation }] : [])),
    ),
    lines,
  };
}

export const extendedCategories = groups.map(([id, zh, en]) => Object.freeze({ id, zh, en }));
export const extendedLibrary = groups.flatMap((group) =>
  group[3].map((topic, index) => makeTopic(group, topic, index, false)),
);
export const extendedEnglishLibrary = groups.flatMap((group) =>
  group[3].map((topic, index) => makeTopic(group, topic, index, true)),
);

export const easterEggTopic = {
  schemaVersion: 1,
  sourceMode: 'source-only',
  id: 'easter-egg',
  title: '彩蛋',
  keyword: '找到',
  emoji: '？',
  relations: [],
  lines: [
    {
      id: 'easter-egg-1',
      text: '你怎么找到这里的',
      keyword: '找到',
      keywords: [{ text: '找到', role: 'primary' }],
      sentenceType: 'opening',
      holdBeats: 8,
    },
  ],
};
export const easterEggEnglishTopic = {
  ...easterEggTopic,
  title: 'Easter egg',
  lines: easterEggTopic.lines.map((line) => ({
    ...line,
    keywords: line.keywords.map((entry) => ({ ...entry })),
  })),
};
