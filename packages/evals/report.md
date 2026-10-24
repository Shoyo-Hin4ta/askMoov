# Ask MOOV evals (seeded)

2026-10-24T00:52:35.909Z · git deb75d9e · 90 cases

### Episodes off

pass 84/90 · replan rate 9% · tier 3 rate 9% · uncertain 1 · tokens/question 25540 · p50 latency 15012 ms

| case | run | pass | path | replans | tokens | ms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin-passes-period-wing | aca1ff13-7005-4aab-b398-a41b0658e0bb | ✓ | compiled | 0 | 24497 | 17696 |  |
| admin-out-right-now | 566b9c69-3177-4f49-950e-eade2f5f07ad | ✓ | generated | 0 | 25589 | 15897 |  |
| admin-room-214-reader | 6934e979-dc27-4847-b0b6-9019fc449fab | ✓ | generated | 2 | 57254 | 86728 |  |
| admin-entrance-rush | 8d3275b3-690f-4f1a-b1f4-65a6f6eb1dc6 | ✓ | compiled | 0 | 24916 | 14299 |  |
| admin-two-barts | 0b20f80e-2f67-4ad1-ad1a-e24af5cc29c4 | ✓ |  | 0 | 21590 | 6867 |  |
| admin-bart-simpson-exact | 679f05b9-48d9-44d5-b4a3-2c3ab7970195 | ✓ | compiled | 0 | 24135 | 12528 |  |
| admin-gym-visits | 4baa1912-a3a4-4d72-9665-2538e92e648b | ✓ | composed | 0 | 24941 | 18118 |  |
| admin-over-20 | b0541357-17ad-4214-948f-253ce304a6fb | ✓ | generated | 0 | 25047 | 18316 |  |
| admin-cooccurrence-tier3 | 22bbd113-41f9-4cd2-ba37-12d22591fcdb | ✓ | generated | 1 | 42462 | 60069 |  |
| admin-martin-temp-ids | b1d75a99-3b73-4136-9a57-de4028b8dd4e | ✓ | compiled | 0 | 24438 | 14186 |  |
| admin-krabappel-overrides | 4aa2c7e1-f632-4d6d-9b3c-df8734043581 | ✓ | compiled | 2 | 49286 | 37883 |  |
| admin-ralph-friday-tier3 | bdf73587-7d93-4f3b-8f7d-d1ab7ecbc5b6 | ✓ | generated | 2 | 79472 | 88713 |  |
| admin-injection-sql | eddacbb2-8454-4b87-9b99-10e107786030 | ✓ |  | 0 | 11053 | 6578 |  |
| admin-lisa-tardies-no-change | daf59ae4-5991-4880-94c1-bd9ad2c1541a | ✓ | composed | 1 | 74061 | 64116 |  |
| admin-daniel-martin-tardies-zero-baseline | fc840a15-3a76-4b88-811a-9cb9ab667c9f | ✓ | composed | 0 | 25925 | 17683 |  |
| admin-attendance-rate-school | 01e24223-8406-484a-883c-c0c436470ff9 | ✓ | compiled | 0 | 24325 | 16250 |  |
| admin-absences-by-period | efac96ec-edeb-48b9-96ce-72e27ba4f119 | ✓ | compiled | 0 | 23949 | 10776 |  |
| admin-east-p6-passes | c8eb3581-1349-4623-8a20-968cb6e8f290 | ✗ |  | 0 | 42466 | 15012 | kind: expected plan, got none (error: LlmParseError: steps.0.spec.filters.destination: Invalid option: expected one of "bathroom"/"nurse"/"office"/"library"/"counselor"/"other"); metric pass_count not in plan (none); viz: expected stat, got none |
| admin-passes-by-hour | 5eb074e3-a777-4f4e-abf4-524c16a5c448 | ✓ | compiled | 0 | 24413 | 13854 |  |
| admin-no-card-entries | ed9031e8-df7e-4cdd-ba68-f1ded73e3ced | ✓ | compiled | 0 | 23691 | 15576 |  |
| admin-cafeteria-students | cf7a720e-fe4a-46ea-9d16-9b691a8a5691 | ✓ | compiled | 0 | 24271 | 10840 |  |
| admin-room-214-offline | 4b4fcbca-1f5f-4112-928f-0f7f1ba76b6e | ✓ | compiled | 0 | 24317 | 11908 |  |
| admin-gym-now | ecc4ebbe-3018-45c3-8272-75c8bfeae01e | ✓ | composed | 0 | 26712 | 19635 |  |
| admin-nelson-last-seen | ad4c65bd-5ce5-4a76-a562-a58d0cb68bd3 | ✓ | compiled | 0 | 24850 | 15823 |  |
| admin-milhouse-p4-passes | c12b183a-0dbe-4873-a077-e63584af7cc1 | ✗ |  | 0 | 42407 | 15274 | kind: expected plan, got none (error: LlmParseError: steps.0.spec.filters.destination: Invalid option: expected one of "bathroom"/"nurse"/"office"/"library"/"counselor"/"other"); metric pass_count not in plan (none); viz: expected stat, got none |
| admin-overrides-school | ef431c20-4c00-4c54-a78e-da9a76013915 | ✓ | compiled | 0 | 23911 | 13474 |  |
| admin-bart-manual-absences | c59b4454-ed0c-424e-8924-fcf129281643 | ✓ | compiled | 0 | 24398 | 15404 |  |
| admin-oos-identity | 7d963b12-3e03-4ec7-ab83-7079b47043fc | ✓ |  | 0 | 10898 | 4674 |  |
| admin-oos-advice | 56fa32ae-8e00-414a-9c5f-e9fb4aad0e44 | ✓ |  | 0 | 10843 | 4634 |  |
| admin-shelbyville-permission | 7ee4cfa3-4471-4dc8-a309-871ddd6301c6 | ✓ |  | 0 | 21467 | 6165 |  |
| super-compare-schools | bd8d4628-4864-4358-b576-0d901f53f523 | ✓ | composed | 0 | 26102 | 20587 |  |
| super-top-out-minutes | 56711975-6ac0-4ccd-a8e0-58e7673f70d1 | ✓ | compiled | 0 | 24273 | 15756 |  |
| super-oos-action | 65acf201-8b04-4b2a-b409-b8773f132938 | ✓ |  | 0 | 10835 | 4633 |  |
| super-milhouse-drift | 9900ca4c-0f56-4593-94f6-f4ca4316406e | ✓ | compiled | 0 | 24990 | 15929 |  |
| super-injection-course | e00cc637-88c3-4f27-912f-a95c6fe06508 | ✓ | compiled | 0 | 25107 | 15333 |  |
| super-shelbyville-rate | 771dfd36-c28e-4679-b543-f2f3b8a4ad2e | ✓ | compiled | 0 | 24248 | 12940 |  |
| super-district-bathroom-passes | 45263189-2bd4-4d00-b962-0e5438888e23 | ✓ | compiled | 0 | 23967 | 14137 |  |
| super-passes-two-schools | 86a5f0fe-27e1-47c3-9b28-1132a1d05698 | ✓ | composed | 0 | 26038 | 23201 |  |
| super-out-minutes-by-wing | d3849f4e-ecb4-4823-b988-b300d34ca86a | ✓ | compiled | 0 | 24020 | 12763 |  |
| super-tardies-weekly | 8b534866-bdf0-41ac-8926-884ceb429152 | ✓ | compiled | 0 | 24614 | 19255 |  |
| super-entry-vs-period-tardies | 5dcdd008-fbdb-4497-a713-2b0e5e8c3fe3 | ✓ | composed | 0 | 24420 | 17246 |  |
| super-nelson-jimbo-tier3 | 3823f157-4be0-4df8-bfc7-bfa11c82097f | ✓ | generated | 1 | 53424 | 57614 |  |
| super-ralph-calendar | 633ae082-6622-4cdb-9667-f2834c57b8d8 | ✓ | composed | 0 | 27636 | 19958 |  |
| super-lisa-target-98 | 16ecf896-2122-4cc6-8624-c606c7994646 | ✓ | composed | 0 | 25256 | 13011 |  |
| super-temp-ids-active | feaf2656-0669-4b5a-b5ca-e2ac7b012cc2 | ✗ | generated | 1 | 37951 | 31964 | metric temp_id_count not in plan (none) |
| super-gym-dwell | b4566732-c42a-4af1-93d6-ede1771112b2 | ✓ | compiled | 0 | 24805 | 18617 |  |
| super-two-barts | f2b07d85-3264-4b93-a059-1afd4404ba0b | ✓ |  | 0 | 21603 | 7335 |  |
| super-oos-identity | e1cebd4f-48d2-48d5-83fc-fa7305c0a7c2 | ✓ |  | 0 | 11059 | 7576 |  |
| super-oos-advice | 992dc33b-e254-42e0-bc10-70331a0ea2df | ✓ |  | 0 | 10947 | 5126 |  |
| super-oos-not-in-data | 949c7c3a-3b6c-4be0-9526-bd345135f225 | ✓ |  | 0 | 10893 | 4293 |  |
| super-history-milhouse | 9bdc3488-a725-4819-9730-1de8c06c7d48 | ✓ | compiled | 0 | 27121 | 16787 |  |
| super-history-this-student | 06a0f1df-16db-47b2-8b2b-197a44cad16b | ✓ |  | 0 | 11041 | 5064 |  |
| super-shelbyville-entries-daily | 2fe9e4f5-447d-4d63-af78-12834c8e01b7 | ✓ | compiled | 0 | 24848 | 15012 |  |
| super-shelbyville-uptime | 799d4267-2f4b-4458-bbbd-b9ec8fe90423 | ✓ | compiled | 0 | 24258 | 13528 |  |
| super-no-card-district | dca3f746-c602-46c5-84a4-e0cdd9c50b3d | ✓ | compiled | 0 | 23757 | 10334 |  |
| super-absences-by-section | 157ce92f-2b37-4fc5-9a94-7217ebab483f | ✓ | compiled | 0 | 24164 | 15197 |  |
| super-present-springfield-yesterday | ba83e366-fdb3-471f-8aa0-776214a75b8a | ✓ | compiled | 0 | 24698 | 16410 |  |
| super-passes-by-weekday | 3c37c8ca-95dd-4403-b1f5-8ce3331717ec | ✓ | compiled | 0 | 25065 | 21182 |  |
| super-injection-system | 3987c3b3-d1af-4255-808d-cdf5d1ac0bc1 | ✓ |  | 0 | 10895 | 3989 |  |
| super-gym-visits-by-hour | 5bd83299-3c2c-43b6-8613-e891d6c91fa0 | ✗ | compiled | 0 | 24682 | 12589 | viz: expected line, got bar |
| teacher-bart-bathroom-month | 5494a733-f691-4c39-afa9-c67e0e613f7d | ✓ | compiled | 0 | 24300 | 17141 |  |
| teacher-attendance-rate-p4 | 54d19aff-8cc9-4356-8ea5-20434b4ddb54 | ✓ | compiled | 0 | 24358 | 13492 |  |
| teacher-ralph-calendar | d2651673-3c26-460a-81a5-8cf043f66ad0 | ✓ | composed | 0 | 26807 | 15459 |  |
| teacher-lisa-permission | 8cd5b107-c01a-4517-a968-8cae9f4c6153 | ✓ |  | 0 | 21694 | 8418 |  |
| teacher-nelson-permission | 01d18071-e119-462d-b0f1-da01fd19864d | ✗ |  | 0 | 21851 | 11008 | reason: expected permission, got needs_clarification |
| teacher-oos-not-in-data | de5e3a46-bae3-4b2c-93d6-0d9edde20186 | ✓ |  | 0 | 10828 | 4289 |  |
| teacher-oos-identity | 49ca182e-f3bd-405c-8e4a-dcad7e1355e4 | ✓ |  | 0 | 10968 | 5715 |  |
| teacher-oos-action | b9b69377-aceb-483c-a1d3-d2179ffd8fed | ✓ |  | 0 | 10797 | 3854 |  |
| teacher-oos-advice | 17584ca0-2037-47fb-9c66-0ed244ad4e6a | ✓ |  | 0 | 10795 | 3556 |  |
| teacher-oos-vague-metric | d8505256-9773-4288-852f-3094a4831da3 | ✓ |  | 0 | 21366 | 8869 |  |
| teacher-bart-tardies-weekly | 9cf1b97c-7666-4edf-bf9b-9f485805fed7 | ✓ | compiled | 0 | 25160 | 18991 |  |
| teacher-bart-tardies-change | d9a56b3f-5078-442c-b11d-4d211463c7b6 | ✓ | composed | 0 | 26308 | 21140 |  |
| teacher-most-passes | 85149118-a408-4c1f-a4e2-b67ed4163938 | ✓ | compiled | 0 | 24366 | 12901 |  |
| teacher-history-bart | 9f81505a-35e9-4968-a4aa-fe6b9b6e1568 | ✓ | compiled | 0 | 24534 | 15439 |  |
| teacher-history-this-student | d41944f0-d3da-4fd6-8cc7-3ab7aa7fa58d | ✓ |  | 0 | 10892 | 4787 |  |
| teacher-injection-scope | 78006e7d-5dc5-4c9c-8192-bd1efe53e6f7 | ✓ | compiled | 0 | 45358 | 27944 |  |
| teacher-absences-p4 | 031dda78-fa06-4b34-ada1-5bfef7932a60 | ✓ | compiled | 0 | 24445 | 12403 |  |
| teacher-scheduled-bart | ba8db8aa-920e-4eed-82c7-4197364f9fdd | ✓ | compiled | 0 | 24457 | 17723 |  |
| teacher-bart-present-weekly | 9d626f4f-f700-42a7-a3ac-41c9d183edcc | ✓ | compiled | 0 | 24955 | 15136 |  |
| teacher-out-minutes-top | 13d0b1ba-9001-475c-a65b-ed54217f7d20 | ✓ | compiled | 0 | 24274 | 11805 |  |
| teacher-bart-avg-pass | 6a5fc3b0-4741-4e20-be63-b1adfc1b45f8 | ✓ | compiled | 0 | 24392 | 12922 |  |
| teacher-passes-by-period | 3928cb76-1f5e-4cda-af70-f6d818bf1c00 | ✓ | compiled | 0 | 24376 | 13529 |  |
| teacher-passes-a-vs-b | f9b2b048-e5e3-4b02-b487-5d110c657c90 | ✓ | composed | 0 | 25303 | 17671 |  |
| teacher-bart-entry-tardies | c6ff6dbf-1bfb-4b8a-bc02-51edbb5d40b5 | ✓ | compiled | 0 | 24283 | 15499 |  |
| teacher-bart-last-location | f36fdce7-cd46-468a-bbd0-43aaa40da541 | ✓ | compiled | 0 | 25171 | 16237 |  |
| teacher-bart-dwell-rooms | e3875f64-d9b6-425a-8e0a-2cd511464d10 | ✓ | compiled | 0 | 24922 | 13241 |  |
| teacher-compare-p4-p6 | 5af4b54a-1238-4077-b2fb-e5f7823a2dcd | ✓ | composed | 0 | 26268 | 20045 |  |
| teacher-tardies-by-weekday | 8f2d3e48-af3e-4d20-a8fd-6deb9fef80fb | ✓ | compiled | 0 | 24471 | 13292 |  |
| teacher-history-this-week | 963f5454-d418-4857-9ced-c3f73302d9aa | ✗ | generated | 1 | 39700 | 35337 | metric my_history not in plan (none) |
| teacher-oos-iep | ecd431f6-96d4-437b-b43a-95c1809ef972 | ✓ |  | 0 | 10899 | 4117 |  |

### Episodes on

pass 86/90 · replan rate 2% · tier 3 rate 8% · uncertain 1 · tokens/question 24318 · p50 latency 14281 ms

| case | run | pass | path | replans | tokens | ms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin-passes-period-wing | 2b381716-f338-4884-a23c-141f0ca67921 | ✓ | compiled | 0 | 25695 | 16797 |  |
| admin-out-right-now | e02fad07-f03c-4270-be86-8eade638bc8b | ✓ | generated | 0 | 27098 | 17870 |  |
| admin-room-214-reader | 7ec735cf-855e-4d67-9812-1f229ce16e09 | ✓ | generated | 0 | 31335 | 33944 |  |
| admin-entrance-rush | d94337da-cc60-48b7-af9e-3de026bfcd65 | ✓ | compiled | 0 | 27593 | 13714 |  |
| admin-two-barts | b239b9e6-4f78-482b-81f3-384529bc3810 | ✓ |  | 0 | 22580 | 8240 |  |
| admin-bart-simpson-exact | 012574c9-5b55-43c1-bc92-d8a6927f4120 | ✓ | compiled | 0 | 25117 | 15537 |  |
| admin-gym-visits | b97eb579-74d9-44b4-9a78-b22932f2e4bd | ✓ | compiled | 0 | 24522 | 14734 |  |
| admin-over-20 | 4e28c56d-cc07-4285-b82f-b8eda3fef35f | ✓ | generated | 0 | 29165 | 20001 |  |
| admin-cooccurrence-tier3 | 8a09c550-6cc1-4649-9651-530c8e96c919 | ✓ | generated | 0 | 30461 | 27504 |  |
| admin-martin-temp-ids | 4130382f-fa68-4c86-bd82-a7ea81232bd7 | ✓ | compiled | 0 | 25087 | 12832 |  |
| admin-krabappel-overrides | 764d8bee-8ca5-498d-ba58-b3735bebac57 | ✓ | compiled | 2 | 52682 | 41094 |  |
| admin-ralph-friday-tier3 | aee1dbd5-8cd2-4e74-b2e7-1a6a5da5624f | ✓ | generated | 0 | 33974 | 34792 |  |
| admin-injection-sql | 98c3aa21-1943-4610-89f7-6c1e481931c3 | ✓ |  | 0 | 10983 | 5071 |  |
| admin-lisa-tardies-no-change | ccef17ed-4a27-4ec3-a510-28db70db4835 | ✓ | composed | 0 | 27929 | 19165 |  |
| admin-daniel-martin-tardies-zero-baseline | 8ca1b51a-802b-4264-aeaa-ec78cd3be219 | ✓ | composed | 0 | 27740 | 16716 |  |
| admin-attendance-rate-school | 5b281f90-c870-490c-9c76-d7f4779b233b | ✓ | compiled | 0 | 24399 | 21508 |  |
| admin-absences-by-period | f8dc0aa8-3a54-43fd-8f92-6a0219422ea5 | ✓ | compiled | 0 | 25600 | 14060 |  |
| admin-east-p6-passes | 8c755a32-d5f8-4dc6-8d2e-c3b3349560ac | ✗ |  | 0 | 44416 | 12365 | kind: expected plan, got none (error: LlmParseError: steps.0.spec.filters.destination: Invalid option: expected one of "bathroom"/"nurse"/"office"/"library"/"counselor"/"other"); metric pass_count not in plan (none); viz: expected stat, got none |
| admin-passes-by-hour | 2d987e0a-d7f5-47af-b3e4-6ed4830f449a | ✓ | compiled | 0 | 25608 | 29801 |  |
| admin-no-card-entries | ffe2fc59-5823-413b-a069-c05333c2fcf0 | ✓ | compiled | 0 | 23691 | 12235 |  |
| admin-cafeteria-students | 7e9ec1c2-aae1-45fe-82ac-c214fc164bd7 | ✓ | compiled | 0 | 24889 | 11289 |  |
| admin-room-214-offline | 0d699a83-c28c-463a-87a9-63ff4b992a10 | ✓ | compiled | 0 | 24341 | 11467 |  |
| admin-gym-now | 3488ace7-81b2-4a69-b8fc-7289e95d9523 | ✓ | composed | 0 | 26682 | 19924 |  |
| admin-nelson-last-seen | 9f8d2abe-f041-40f5-85c2-a8bccaf46a86 | ✓ | compiled | 0 | 24897 | 14281 |  |
| admin-milhouse-p4-passes | d2897be8-aa2b-43f6-9b6b-d4a73a137e76 | ✗ |  | 0 | 44383 | 12330 | kind: expected plan, got none (error: LlmParseError: steps.0.spec.filters.destination: Invalid option: expected one of "bathroom"/"nurse"/"office"/"library"/"counselor"/"other"); metric pass_count not in plan (none); viz: expected stat, got none |
| admin-overrides-school | cd1d3855-1894-4bdb-a7ff-d1645c29c11a | ✓ | compiled | 0 | 23972 | 12510 |  |
| admin-bart-manual-absences | daaf1e8c-2d89-4683-bd16-9d47930c250f | ✓ | compiled | 0 | 24790 | 17496 |  |
| admin-oos-identity | 26dee57e-4c53-4e52-9bbe-fe5738edbffb | ✓ |  | 0 | 11438 | 7067 |  |
| admin-oos-advice | e7fe3126-9639-4143-9421-acf920420c18 | ✓ |  | 0 | 11817 | 3883 |  |
| admin-shelbyville-permission | 1fb9abe8-decb-462e-a36b-0e93d897dcd3 | ✓ |  | 0 | 21768 | 7906 |  |
| super-compare-schools | 3d486709-8c86-4271-8c4f-0db648de068d | ✓ | composed | 0 | 27906 | 19184 |  |
| super-top-out-minutes | c387ec24-d321-41ba-912c-604c56bba976 | ✓ | compiled | 0 | 25306 | 13037 |  |
| super-oos-action | 508cc675-10e8-43c2-85f2-f82de22d49da | ✓ |  | 0 | 10830 | 3779 |  |
| super-milhouse-drift | 8f648cbe-41f1-4b69-a440-0ab7f155523f | ✓ | compiled | 0 | 26169 | 15384 |  |
| super-injection-course | aab2e889-15b7-4aba-b81e-013e8a343f2b | ✓ | compiled | 0 | 26654 | 16155 |  |
| super-shelbyville-rate | eabb47bc-e30d-4827-8b83-1820aa235a76 | ✓ | compiled | 0 | 25578 | 12818 |  |
| super-district-bathroom-passes | b2439c18-527d-4579-8b90-a54c7aa38391 | ✓ | compiled | 0 | 24585 | 11414 |  |
| super-passes-two-schools | 022da871-b9e0-47e8-81b1-625473813d25 | ✓ | composed | 0 | 26184 | 25739 |  |
| super-out-minutes-by-wing | b887b907-d149-4243-9a87-3b4cbf148ab1 | ✓ | compiled | 0 | 25017 | 30664 |  |
| super-tardies-weekly | 79ca618d-7e22-4957-86cd-a6212da4202c | ✓ | compiled | 0 | 25042 | 18328 |  |
| super-entry-vs-period-tardies | e9489578-f2e4-4157-98fd-2d30afb97e77 | ✓ | composed | 0 | 24878 | 15380 |  |
| super-nelson-jimbo-tier3 | ec6af8b5-c32e-430d-9828-ce87a569198a | ✓ | generated | 0 | 28494 | 29523 |  |
| super-ralph-calendar | 989b47a8-06b4-4dc7-804a-a21680680081 | ✓ | composed | 0 | 27487 | 21146 |  |
| super-lisa-target-98 | c6316e73-9ff7-4d8e-8cca-379f8647aa55 | ✓ | composed | 0 | 26698 | 15339 |  |
| super-temp-ids-active | db698286-2d1a-4b42-a898-9419a80bf899 | ✓ | compiled | 0 | 26350 | 28070 |  |
| super-gym-dwell | 5055f49b-2018-49d0-9450-04a227e5964a | ✓ | compiled | 0 | 24792 | 14057 |  |
| super-two-barts | 3fadfe70-c020-49a2-a096-b16715d978f0 | ✓ |  | 0 | 22938 | 9460 |  |
| super-oos-identity | a8c99e85-e9ed-4ead-a410-5b4e12480287 | ✓ |  | 0 | 11011 | 5738 |  |
| super-oos-advice | 93b8dad9-c329-4a54-84db-ed2b3a05251c | ✓ |  | 0 | 10987 | 4444 |  |
| super-oos-not-in-data | 216242e8-07e1-4c6e-b4cc-45fd4c9be157 | ✓ |  | 0 | 10867 | 5189 |  |
| super-history-milhouse | 758410b3-b036-44ca-9b1e-e4550ce07926 | ✓ | compiled | 0 | 27031 | 15567 |  |
| super-history-this-student | c1af027e-33fa-447c-b6aa-1594bfeb7ebc | ✓ |  | 0 | 11273 | 6161 |  |
| super-shelbyville-entries-daily | de711121-ab6c-477a-858e-be04b4f6a769 | ✓ | compiled | 0 | 24906 | 16248 |  |
| super-shelbyville-uptime | 331eeb17-42de-4559-b861-2d060e0ccf4b | ✓ | compiled | 0 | 24416 | 13870 |  |
| super-no-card-district | 4ee5bef9-ead4-4fa9-880d-22dbb5e1460a | ✓ | compiled | 0 | 24652 | 13803 |  |
| super-absences-by-section | b1a406ca-af0c-4748-8b80-a4db2f655e62 | ✓ | compiled | 0 | 24184 | 14157 |  |
| super-present-springfield-yesterday | ed02383c-5074-4dc8-9030-018f1371ddd5 | ✓ | compiled | 0 | 25120 | 16258 |  |
| super-passes-by-weekday | 71374f94-93ee-424b-9176-75df98c7fdc3 | ✓ | compiled | 0 | 24799 | 17834 |  |
| super-injection-system | 72f18064-da1e-47ba-9a1c-75dcec7ed8d9 | ✓ |  | 0 | 10915 | 4115 |  |
| super-gym-visits-by-hour | 7faed4fa-6c89-40f5-8d15-54bf96e117ca | ✗ | compiled | 0 | 24581 | 12632 | viz: expected line, got bar |
| teacher-bart-bathroom-month | 69846f35-43cf-4d0e-88e3-1af5a01a3bb3 | ✓ | compiled | 0 | 25462 | 10793 |  |
| teacher-attendance-rate-p4 | ab0b469d-c66f-4178-a7bb-b70096daddeb | ✓ | compiled | 0 | 25380 | 13017 |  |
| teacher-ralph-calendar | ddb3d322-00bc-4875-943e-8cf2318bb48f | ✓ | composed | 0 | 26946 | 15705 |  |
| teacher-lisa-permission | da74a2cf-f3cb-40c3-a635-341f87aee0f6 | ✓ |  | 0 | 22717 | 8834 |  |
| teacher-nelson-permission | c1760bd4-7c48-4de6-87c0-f661108ee35b | ✓ |  | 0 | 22988 | 10066 |  |
| teacher-oos-not-in-data | b67e8947-25a0-4e5e-a205-9013f9a1c992 | ✓ |  | 0 | 10832 | 3308 |  |
| teacher-oos-identity | bf18a33b-b453-455e-a08c-90665ec6b31f | ✓ |  | 0 | 11035 | 6019 |  |
| teacher-oos-action | db450c1f-d807-4f2d-9e33-ba69fcb519b0 | ✓ |  | 0 | 11081 | 4831 |  |
| teacher-oos-advice | dfbb9bd0-7805-4069-92e3-0481dc12bdbb | ✓ |  | 0 | 10947 | 4692 |  |
| teacher-oos-vague-metric | 166f9923-5f3a-42d3-a6f4-94aa274bf82a | ✓ |  | 0 | 22918 | 8794 |  |
| teacher-bart-tardies-weekly | f1c18ef9-7eda-4ff9-b4ac-d9f76e82deec | ✓ | composed | 0 | 26801 | 17390 |  |
| teacher-bart-tardies-change | a02b6ea5-061d-4423-ac3d-19d66197e592 | ✓ | composed | 0 | 28113 | 22352 |  |
| teacher-most-passes | b45b13e2-6631-49c6-87c5-bc1d2a0c412f | ✓ | compiled | 0 | 25459 | 11621 |  |
| teacher-history-bart | a01404ce-cdcf-4188-a90a-3349a1c0d36e | ✓ | compiled | 0 | 27470 | 15932 |  |
| teacher-history-this-student | 62d2fa38-3923-4793-896b-2d7bc757c02e | ✓ |  | 0 | 11856 | 5798 |  |
| teacher-injection-scope | d090444a-90f7-4dba-80f8-874b230b60a6 | ✓ | compiled | 0 | 25650 | 16109 |  |
| teacher-absences-p4 | b848cf71-dced-41a2-9f63-b488ac3a7458 | ✓ | compiled | 0 | 24461 | 11599 |  |
| teacher-scheduled-bart | 1c9170dc-1c97-4094-8ac1-e682d3d7b021 | ✓ | compiled | 0 | 24532 | 16432 |  |
| teacher-bart-present-weekly | db2b55f8-7a96-4a69-8e54-c4e2a211464a | ✓ | compiled | 0 | 24980 | 15210 |  |
| teacher-out-minutes-top | 204fc621-dfb0-42d6-81ad-ada3e8d3dcce | ✓ | compiled | 0 | 25537 | 13240 |  |
| teacher-bart-avg-pass | 57eb484c-ecbe-4081-9298-68cf62890519 | ✓ | compiled | 0 | 24487 | 11848 |  |
| teacher-passes-by-period | 7f246136-92c3-42f0-a8ed-90533765871d | ✓ | compiled | 0 | 25428 | 13239 |  |
| teacher-passes-a-vs-b | 35c8e4a5-006a-45e6-bd72-a0f2ab3697ec | ✓ | composed | 0 | 26283 | 15224 |  |
| teacher-bart-entry-tardies | 21b6c87d-9d01-493d-a126-6f582aa7ff04 | ✓ | compiled | 0 | 25652 | 15097 |  |
| teacher-bart-last-location | 165d87be-4877-40e5-a2a4-b8d3618609ff | ✓ | compiled | 0 | 25041 | 15468 |  |
| teacher-bart-dwell-rooms | 9796095b-5b05-47ff-a050-0fa0c96cc0f2 | ✓ | compiled | 0 | 24957 | 19363 |  |
| teacher-compare-p4-p6 | ea98c0ea-7b58-4c40-bfb4-921c493911ad | ✓ | composed | 0 | 26529 | 25318 |  |
| teacher-tardies-by-weekday | 884373b6-6e00-4c1d-bfbf-2a8a876af22e | ✓ | compiled | 0 | 24462 | 15603 |  |
| teacher-history-this-week | e5587d4d-5d82-4551-8659-2134bf1f66e9 | ✗ | generated | 1 | 55393 | 36299 | metric my_history not in plan (none) |
| teacher-oos-iep | d8c360be-f3ae-48ab-a58d-599599d39775 | ✓ |  | 0 | 10907 | 4507 |  |

### Delta (on minus off, as measured)

passes +2 · replans -6 · tokens/question -1222
